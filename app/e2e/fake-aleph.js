// After Le-Space/belege (bridge/test/support/fake-aleph.js) at 4505177,
// published here under the MIT license by its author. Kept: how strictly it
// takes STORE and AGGREGATE messages, as Aleph was measured on 2026-10-02 and
// 2026-10-03 (NiKrause/orbitdb-storage-bridge#147). Changed: only what a
// backup from the browser touches, with CORS on every answer — this app speaks
// to Aleph from the page, where belege's bridge did from Node — and an unknown
// account's balance is 0, as Aleph answers; no credit history.
//
// A fake Aleph on 127.0.0.1 for the backup spec. Every address, key and amount
// in it is made up.
//   POST /api/v0/add       multipart `file` → one JSON line { Name, Hash, Size }
//   GET  /ipfs/<id>        the bytes as they were added
//   POST /api/v0/messages  { message, sync }:
//     - a STORE whose item_hash is the sha-256 of its content, naming a file
//       that was added, signed (personal_sign) by its sender → 200 `processed`;
//       a wrong signature → 202 `pending`; a malformed one → 422;
//     - its content's `address` is the paying account: the sender itself, or an
//       account whose `security` aggregate lets the sender send STORE on that
//       channel (otherwise 202, then `rejected`);
//     - with `payment: { type: 'credit' }` the paying account needs credit for a
//       day of the file, about 54 credits per MiB (otherwise 202, then
//       `rejected`, error 6, with the amounts); without a payment Aleph books
//       `hold` and processes it;
//     - an AGGREGATE on channel `security`, key `security`, sent by the account
//       itself, sets that account's grants.
//   GET  /api/v0/messages/<item hash>   status, with `error_code` and `details` when rejected
//   GET  /api/v0/aggregates/<address>.json?keys=security   the grants
//   GET  /api/v0/messages.json   STOREs by `owners` (the paying account) or `addresses` (the sender)
//   GET  /api/v0/addresses/<address>/balance   `credit_balance`
// For the spec: `grant(owner, entry)` does what belege's
// `pnpm setup:aleph -- --authorize` does; `fund(owner, credits)` what a transfer does.
import http from 'node:http';
import { createHash } from 'node:crypto';

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

import { toChecksumAddress } from '../src/lib/aleph-signer.js';

/** Credits a day of keeping costs, per MiB: 107.80… for 2 MiB, as Aleph asked on 2026-10-03. */
export const FAKE_CREDITS_PER_MIB_DAY = 107.80493418375659 / 2;

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** @param {Uint8Array} bytes */
function base58(bytes) {
	let n = BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
	let out = '';
	while (n > 0n) {
		out = ALPHABET[Number(n % 58n)] + out;
		n /= 58n;
	}
	for (const b of bytes) {
		if (b !== 0) break;
		out = `1${out}`;
	}
	return out;
}

/** A CIDv0-shaped id for bytes (sha-256 multihash, base58), as Aleph's IPFS host answers. @param {Uint8Array} bytes */
const cidOf = (bytes) =>
	base58(new Uint8Array([0x12, 0x20, ...createHash('sha256').update(bytes).digest()]));

/** The address that signed a personal_sign message, or null. @param {string} signature @param {string} message */
function signerOf(signature, message) {
	try {
		const sig = Buffer.from(signature.replace(/^0x/, ''), 'hex');
		if (sig.length !== 65) return null;
		const body = new TextEncoder().encode(message);
		const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`);
		const digest = keccak_256(new Uint8Array([...prefix, ...body]));
		const recovered = new Uint8Array([sig[64] - 27, ...sig.subarray(0, 64)]);
		const pub = secp256k1.Point.fromBytes(
			secp256k1.recoverPublicKey(recovered, digest, { prehash: false })
		).toBytes(false);
		return toChecksumAddress(
			`0x${Buffer.from(keccak_256(pub.slice(1)).slice(-20)).toString('hex')}`
		);
	} catch {
		return null;
	}
}

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'content-type'
};

export async function startFakeAleph() {
	/** Credits by checksummed address. @type {Map<string, number>} */
	const credits = new Map();
	/** What was uploaded, by id. @type {Map<string, Uint8Array>} */
	const added = new Map();
	/** Each account's grants, by checksummed address. @type {Map<string, any[]>} */
	const grants = new Map();
	/** The STORE messages taken. */
	const stores =
		/** @type {{ sender: string, owner: string, cid: string, channel: string, time: number, itemHash: string, payment: string | null, status: string, errorCode?: number, details?: unknown }[]} */ ([]);
	/** The AGGREGATE messages taken, by item hash. @type {Map<string, string>} */
	const aggregates = new Map();

	/** @param {string} owner @param {string} sender @param {string} channel */
	const allowed = (owner, sender, channel) =>
		(grants.get(toChecksumAddress(owner)) ?? []).some(
			(g) =>
				String(g?.address).toLowerCase() === sender.toLowerCase() &&
				(!g.types?.length || g.types.includes('STORE')) &&
				(!g.channels?.length || g.channels.includes(channel)) &&
				(!g.chain || g.chain === 'ETH')
		);

	const server = http.createServer(async (req, res) => {
		const url = new URL(String(req.url), 'http://x');
		const reply = (/** @type {number} */ status, /** @type {unknown} */ body) => {
			res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
			res.end(JSON.stringify(body));
		};
		if (req.method === 'OPTIONS') {
			res.writeHead(204, CORS);
			return res.end();
		}

		const ipfs = /^\/ipfs\/([A-Za-z0-9]+)$/.exec(url.pathname);
		if (req.method === 'GET' && ipfs) {
			const bytes = added.get(ipfs[1]);
			if (!bytes) return reply(404, { error: 'not found' });
			res.writeHead(200, { 'Content-Type': 'application/octet-stream', ...CORS });
			return res.end(Buffer.from(bytes));
		}

		if (req.method === 'POST' && url.pathname === '/api/v0/add') {
			const form = await new Request('http://x', {
				method: 'POST',
				headers: { 'content-type': String(req.headers['content-type'] ?? '') },
				body: /** @type {any} */ (req),
				duplex: 'half'
			})
				.formData()
				.catch(() => null);
			const file = form?.get('file');
			if (!file || typeof file === 'string') return reply(400, { Message: 'no file' });
			const bytes = new Uint8Array(await file.arrayBuffer());
			const hash = cidOf(bytes);
			added.set(hash, bytes);
			res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
			return res.end(
				`${JSON.stringify({ Name: file.name, Hash: hash, Size: String(bytes.length) })}\n`
			);
		}

		if (req.method === 'POST' && url.pathname === '/api/v0/messages') {
			/** @type {Buffer[]} */ const chunks = [];
			for await (const c of req) chunks.push(c);
			/** @type {any} */
			let m;
			let content;
			try {
				m = JSON.parse(Buffer.concat(chunks).toString('utf8')).message;
				content = JSON.parse(m?.item_content);
			} catch {
				return reply(422, { error: 'not JSON' });
			}
			const hashOk =
				m.item_hash === createHash('sha256').update(String(m.item_content)).digest('hex');
			const signatureOk =
				signerOf(String(m.signature ?? ''), [m.chain, m.sender, m.type, m.item_hash].join('\n')) ===
				toChecksumAddress(String(m.sender));
			const answer = (/** @type {string} */ status) =>
				reply(status === 'processed' ? 200 : 202, {
					publication_status: { status: 'success', failed: [] },
					message_status: status === 'processed' ? 'processed' : 'pending'
				});

			if (m.type === 'AGGREGATE') {
				const ok =
					hashOk &&
					m.chain === 'ETH' &&
					m.channel === 'security' &&
					content?.key === 'security' &&
					content?.address === m.sender &&
					Array.isArray(content?.content?.authorizations);
				if (!ok) return reply(422, { error: 'not an AGGREGATE this fake takes' });
				const status = signatureOk ? 'processed' : 'rejected';
				aggregates.set(m.item_hash, status);
				if (status === 'processed')
					grants.set(toChecksumAddress(m.sender), content.content.authorizations);
				return answer(status);
			}

			const ok =
				hashOk &&
				m.chain === 'ETH' &&
				m.type === 'STORE' &&
				m.item_type === 'inline' &&
				typeof m.channel === 'string' &&
				typeof m.time === 'number' &&
				content?.item_type === 'ipfs' &&
				typeof content?.address === 'string' &&
				added.has(content?.item_hash) &&
				(content.payment === undefined || ['credit', 'hold'].includes(content.payment?.type));
			if (!ok) return reply(422, { error: 'not a STORE this fake takes' });
			const payment = content.payment?.type ?? null;
			/** @type {{ status: string, errorCode?: number, details?: unknown }} */
			let verdict = { status: 'processed' };
			if (!signatureOk) verdict = { status: 'pending' };
			else if (content.address !== m.sender && !allowed(content.address, m.sender, m.channel)) {
				verdict = { status: 'rejected', errorCode: 3, details: { errors: ['not authorized'] } };
			} else if (payment === 'credit') {
				// The paying account is the owner, never the sender (measured 2026-10-03).
				const have = credits.get(toChecksumAddress(content.address)) ?? 0;
				const mib = /** @type {Uint8Array} */ (added.get(content.item_hash)).length / 1048576;
				const required = mib * FAKE_CREDITS_PER_MIB_DAY;
				if (have < required) {
					verdict = {
						status: 'rejected',
						errorCode: 6,
						details: {
							errors: [
								{
									account_credits: String(have),
									min_runtime_days: 1,
									required_credits: required.toFixed(18)
								}
							]
						}
					};
				}
			}
			stores.push({
				sender: m.sender,
				owner: content.address,
				cid: content.item_hash,
				channel: m.channel,
				time: content.time,
				itemHash: m.item_hash,
				payment,
				...verdict
			});
			return answer(verdict.status);
		}

		const message = /^\/api\/v0\/messages\/([0-9a-f]{64})$/.exec(url.pathname);
		if (req.method === 'GET' && message) {
			const store = stores.find((s) => s.itemHash === message[1]);
			if (store) {
				return reply(200, {
					status: store.status,
					item_hash: store.itemHash,
					...(store.errorCode !== undefined ? { error_code: store.errorCode } : {}),
					...(store.details !== undefined ? { details: store.details } : {})
				});
			}
			const aggregate = aggregates.get(message[1]);
			if (aggregate) return reply(200, { status: aggregate, item_hash: message[1] });
			return reply(404, { error: 'Message not found' });
		}

		const aggregate = /^\/api\/v0\/aggregates\/(0x[0-9a-fA-F]{40})\.json$/.exec(url.pathname);
		if (req.method === 'GET' && aggregate) {
			const owner = aggregate[1];
			const list = grants.get(owner);
			// Aleph keys accounts by their checksummed form.
			if (!list || owner !== toChecksumAddress(owner))
				return reply(404, { error: 'No aggregate found' });
			return reply(200, { address: owner, data: { security: { authorizations: list } } });
		}

		if (req.method === 'GET' && url.pathname === '/api/v0/messages.json') {
			const senders = (url.searchParams.get('addresses') ?? '').split(',').filter(Boolean);
			const owners = (url.searchParams.get('owners') ?? '').split(',').filter(Boolean);
			const channels = (url.searchParams.get('channels') ?? '').split(',').filter(Boolean);
			if (url.searchParams.get('msgTypes') !== 'STORE') return reply(400, { error: 'msgTypes' });
			const found = stores
				.filter((s) => s.status === 'processed')
				.filter((s) => !senders.length || senders.includes(s.sender))
				.filter((s) => !owners.length || owners.includes(s.owner))
				.filter((s) => !channels.length || channels.includes(s.channel))
				.sort((x, y) => y.time - x.time);
			return reply(200, {
				messages: found.map((s) => ({
					type: 'STORE',
					item_hash: s.itemHash,
					sender: s.sender,
					channel: s.channel,
					content: {
						address: s.owner,
						item_type: 'ipfs',
						item_hash: s.cid,
						...(s.payment ? { payment: { type: s.payment } } : {}),
						time: s.time
					}
				})),
				pagination_page: 1,
				pagination_total: found.length,
				pagination_per_page: 50
			});
		}

		const balance = /^\/api\/v0\/addresses\/(0x[0-9a-fA-F]{40})\/balance$/.exec(url.pathname);
		if (req.method === 'GET' && balance) {
			const address = balance[1];
			const have = address === toChecksumAddress(address) ? (credits.get(address) ?? 0) : 0;
			return reply(200, {
				address,
				balance: 0,
				locked_amount: 0,
				credit_balance: have,
				details: {}
			});
		}

		return reply(404, { error: 'not found' });
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
	return {
		url: `http://127.0.0.1:${port}`,
		added,
		stores,
		/** What `pnpm setup:aleph -- --authorize` puts into the account's grants. @param {string} owner @param {any} entry */
		grant(owner, entry) {
			const key = toChecksumAddress(owner);
			const others = (grants.get(key) ?? []).filter(
				(g) => String(g.address).toLowerCase() !== String(entry.address).toLowerCase()
			);
			grants.set(key, [...others, entry]);
		},
		/** Credits on an account, as a transfer puts them there. @param {string} owner @param {number} amount */
		fund(owner, amount) {
			credits.set(toChecksumAddress(owner), amount);
		},
		close: () =>
			new Promise((resolve) => {
				server.close(() => resolve(undefined));
				server.closeAllConnections?.();
			})
	};
}
