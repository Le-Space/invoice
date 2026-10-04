// A backup of the books, and back (Le-Space/invoice#28): the file carries the
// vault in front and the sealed collections behind it, opens with the vault's
// backup key, and puts the books back into a node that never saw them. The
// STORE it is kept by is signed with the vault's Aleph key for the paying
// account, paid in credits, and a refusal says how many credits it takes.
// All keys, addresses and records are made up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHeliaLight } from 'helia';
import { withLibp2p } from '@helia/libp2p';
import { withBitswap } from '@helia/bitswap';
import { createOrbitDB, useIdentityProvider } from '@orbitdb/core';
import * as dagCbor from '@ipld/dag-cbor';
import {
	OrbitDBWebAuthnIdentityProviderFunction,
	createSecretSigner
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import {
	openAppBackup,
	readAppBackupHeader,
	restoreAppBackup
} from '@le-space/orbitdb-storage-bridge/app-backup';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

import { alephAddressOf, toChecksumAddress } from './aleph-signer.js';
import {
	BACKUP_CHANNEL,
	BackupRefusedError,
	backupCipher,
	backupMoment,
	buildBackup,
	creditsOf,
	findBackups,
	isGranted,
	keepBackup,
	pickBackup
} from './backup.js';
import { booksAccessController } from './books-move.js';
import { ensureBackupKeys, ensureBooksSecret, openBooksVault } from './books-vault.js';
import { payloadEncryption } from './entry-encryption.js';
import { createOfflineLibp2p } from './network.js';
import { BOOKS_IDENTITY_INFO, createBooksIdentities } from './session-identities.js';
import { openStore } from './store/repository.js';
import SealedDocuments from './store/sealed-documents.js';

/** localStorage, in memory. */
function memoryStorage() {
	const items = new Map();
	return /** @type {Storage} */ ({
		getItem: (key) => (items.has(key) ? items.get(key) : null),
		setItem: (key, value) => void items.set(key, String(value)),
		removeItem: (key) => void items.delete(key),
		clear: () => items.clear(),
		key: (i) => [...items.keys()][i] ?? null,
		get length() {
			return items.size;
		}
	});
}

const text = (/** @type {string} */ s) => new TextEncoder().encode(s);
const contains = (/** @type {Uint8Array} */ haystack, /** @type {string} */ needle) =>
	Buffer.from(haystack).includes(Buffer.from(needle));

/** A node as the app starts one: offline Helia, OrbitDB signing as the books. */
async function node(/** @type {string} */ label, /** @type {any} */ books) {
	const helia = await withBitswap(
		withLibp2p(createHeliaLight({ codecs: [dagCbor] }), await createOfflineLibp2p())
	).start();
	const directory = await mkdtemp(join(tmpdir(), `invoice-backup-${label}-`));
	const identities = await createBooksIdentities(helia, books);
	const identity = await identities.createIdentity({
		provider: OrbitDBWebAuthnIdentityProviderFunction({ signer: books })
	});
	// @ts-expect-error `identities` is a documented option the bundled types omit
	const orbitdb = await createOrbitDB({ ipfs: helia, identities, identity, directory });
	return { helia, orbitdb, directory };
}

/** @type {any} */ let a;
/** @type {any} */ let b;
/** @type {any} */ let opened;
/** @type {any} */ let books;
/** @type {any} */ let storeA;
/** @type {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array }} */ let passkeyA;

beforeAll(async () => {
	try {
		useIdentityProvider(OrbitDBWebAuthnIdentityProviderFunction);
	} catch {
		// already known
	}
	const storage = memoryStorage();
	passkeyA = {
		prfOutput: crypto.getRandomValues(new Uint8Array(32)),
		rawCredentialId: crypto.getRandomValues(new Uint8Array(16))
	};
	opened = await ensureBackupKeys(
		await ensureBooksSecret(await openBooksVault({ ...passkeyA, storage }), storage),
		storage
	);
	books = await createSecretSigner(opened.values.booksSecret, { info: BOOKS_IDENTITY_INFO });
	a = await node('a', books);
	b = await node('b', books);
	storeA = await openStore({
		orbitdb: a.orbitdb,
		encryptionKey: opened.values.dbKey,
		names: opened.values.names,
		author: 'did:key:z6MkPerson',
		accessController: booksAccessController(books.did)
	});
	const customer = await storeA.customers.put({ name: 'Erster Kunde AG' });
	await storeA.invoices.put({
		number: '2026-00001-001',
		customerId: customer.id,
		totalCents: 12500
	});
	await storeA.settings.put({ key: 'invoice', value: { issuerName: 'Wolkenfabrik Hosting UG' } });
}, 120_000);

afterAll(async () => {
	await storeA?.close();
	for (const side of [a, b]) {
		await side?.orbitdb?.stop();
		await side?.helia?.stop();
		if (side?.directory) await rm(side.directory, { recursive: true, force: true });
	}
});

describe('the backup file', () => {
	it('carries the vault in front, readable without a key, and nothing of the books in the clear', async () => {
		const { bytes, manifest } = await buildBackup({
			databases: storeA.databases(),
			vault: opened.vault,
			backupKey: opened.values.backupKey,
			appVersion: 'test',
			now: () => new Date('2026-10-04T08:15:00Z')
		});
		const { header } = readAppBackupHeader(bytes);
		expect(JSON.parse(new TextDecoder().decode(header))).toEqual(opened.vault);
		expect(manifest).toMatchObject({
			app: 'invoice',
			appVersion: 'test',
			createdAt: '2026-10-04T08:15:00.000Z'
		});
		expect(manifest.metadata.databases.map((/** @type {any} */ d) => d.collection)).toEqual([
			'invoices',
			'customers',
			'settings'
		]);
		for (const marker of ['Erster Kunde AG', 'Wolkenfabrik', '2026-00001-001']) {
			expect(contains(bytes, marker)).toBe(false);
		}
		expect(backupMoment(new Date('2026-10-04T08:15:30Z')).name).toBe(
			'invoice-2026-10-04-0815.backup'
		);
	});

	it('opens with the vault’s backup key only, and puts the books back into a node that never saw them', async () => {
		const { bytes } = await buildBackup({
			databases: storeA.databases(),
			vault: opened.vault,
			backupKey: opened.values.backupKey
		});
		const other = await backupCipher(crypto.getRandomValues(new Uint8Array(32)));
		await expect(
			openAppBackup(bytes, { decrypt: other.decrypt, app: 'invoice' })
		).rejects.toThrow();

		const { decrypt } = await backupCipher(opened.values.backupKey);
		const backup = await openAppBackup(bytes, { decrypt, app: 'invoice' });

		// B: the same books, empty, at the same addresses — what an empty device opens.
		const storeB = await openStore({
			orbitdb: b.orbitdb,
			encryptionKey: opened.values.dbKey,
			names: opened.values.names,
			author: 'did:key:z6MkPerson',
			accessController: booksAccessController(books.did)
		});
		expect(await storeB.invoices.list()).toEqual([]);
		const addresses = Object.fromEntries(
			Object.entries(storeB.databases()).map(([name, db]) => [name, db.address.toString()])
		);
		expect(addresses).toEqual(
			Object.fromEntries(
				Object.entries(storeA.databases()).map(([name, db]) => [name, db.address.toString()])
			)
		);
		await storeB.close();

		const restored = await restoreAppBackup({
			orbitdb: b.orbitdb,
			opened: backup,
			addresses,
			open: {
				type: SealedDocuments.type,
				Database: SealedDocuments({ indexBy: 'id' }),
				encryption: await payloadEncryption(opened.values.dbKey),
				AccessController: booksAccessController(books.did)
			}
		});
		expect(restored.databases.every((/** @type {any} */ d) => d.joined > 0)).toBe(true);

		const back = await openStore({
			orbitdb: b.orbitdb,
			encryptionKey: opened.values.dbKey,
			names: opened.values.names,
			author: 'did:key:z6MkPerson',
			accessController: booksAccessController(books.did)
		});
		expect((await back.invoices.list()).map((/** @type {any} */ r) => r.number)).toEqual([
			'2026-00001-001'
		]);
		expect((await back.customers.list()).map((/** @type {any} */ r) => r.name)).toEqual([
			'Erster Kunde AG'
		]);
		await back.close();
	});
});

/**
 * Aleph as measured on 2026-10-03, enough for one backup: the IPFS host, the
 * messages API with a STORE's status, the grants and the balance.
 *
 * @param {{ credits: number, grants?: any[] }} account
 */
function fakeAleph({ credits, grants = [] }) {
	/** @type {any[]} */ const posted = [];
	/** @type {Map<string, any>} */ const status = new Map();
	const reply = (/** @type {number} */ code, /** @type {any} */ body) => ({
		ok: code < 300,
		status: code,
		json: async () => body,
		text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
	});
	const fetchImpl = async (/** @type {string} */ url, /** @type {any} */ init) => {
		const { pathname } = new URL(url);
		if (pathname === '/api/v0/add')
			return reply(200, `${JSON.stringify({ Name: 'x', Hash: 'QmBackup1' })}\n`);
		if (pathname === '/api/v0/messages' && init?.method === 'POST') {
			const { message } = JSON.parse(init.body);
			posted.push(message);
			const content = JSON.parse(message.item_content);
			const required = 107.80493418375659 / 2; // a MiB-ish file, at the measured price
			const verdict =
				credits >= required
					? { status: 'processed' }
					: {
							status: 'rejected',
							error_code: 6,
							details: {
								errors: [
									{
										account_credits: String(credits),
										min_runtime_days: 1,
										required_credits: String(required)
									}
								]
							}
						};
			status.set(message.item_hash, verdict);
			expect(content.payment).toEqual({ type: 'credit' });
			return reply(202, { message_status: 'pending' });
		}
		const hash = /^\/api\/v0\/messages\/([0-9a-f]{64})$/.exec(pathname)?.[1];
		if (hash) return reply(200, status.get(hash));
		if (/^\/api\/v0\/aggregates\//.test(pathname)) {
			return grants.length
				? reply(200, { data: { security: { authorizations: grants } } })
				: reply(404, {});
		}
		if (/\/balance$/.test(pathname)) return reply(200, { credit_balance: credits });
		return reply(404, {});
	};
	return { fetchImpl, posted };
}

describe('keeping it on Aleph', () => {
	const OWNER = toChecksumAddress(`0x${'ab'.repeat(20)}`);
	const endpoints = {
		ingestUrl: 'https://aleph.test/api/v0/add',
		apiHost: 'https://aleph.test',
		gateways: []
	};

	it('signs the STORE with the vault’s Aleph key, for the paying account, paid in credits', async () => {
		const aleph = fakeAleph({ credits: 1_000_000 });
		const steps = /** @type {string[]} */ ([]);
		const kept = await keepBackup({
			bytes: text('a sealed backup'),
			name: 'invoice-2026-10-04-0815.backup',
			owner: OWNER,
			alephKey: opened.values.alephKey,
			endpoints,
			fetch: /** @type {any} */ (aleph.fetchImpl),
			settle: { timeout: 10, interval: 1 },
			onStep: (step) => steps.push(step)
		});
		expect(kept).toMatchObject({
			cid: 'QmBackup1',
			status: 'processed',
			sender: alephAddressOf(opened.values.alephKey)
		});
		expect(steps).toEqual(['uploading', 'keeping']);

		const [message] = aleph.posted;
		expect(message).toMatchObject({ type: 'STORE', channel: BACKUP_CHANNEL, sender: kept.sender });
		expect(JSON.parse(message.item_content)).toMatchObject({
			address: OWNER,
			item_hash: 'QmBackup1',
			item_type: 'ipfs'
		});
		// The signature is the sender's: recovered from what Aleph checks.
		const payload = text(['ETH', message.sender, 'STORE', message.item_hash].join('\n'));
		const digest = keccak_256(
			new Uint8Array([...text(`\x19Ethereum Signed Message:\n${payload.length}`), ...payload])
		);
		const signature = Uint8Array.from(Buffer.from(message.signature.slice(2), 'hex'));
		const point = secp256k1.Point.fromBytes(
			secp256k1.recoverPublicKey(
				new Uint8Array([signature[64] - 27, ...signature.subarray(0, 64)]),
				digest,
				{ prehash: false }
			)
		).toBytes(false);
		expect(
			toChecksumAddress(`0x${Buffer.from(keccak_256(point.slice(1)).slice(-20)).toString('hex')}`)
		).toBe(kept.sender);
	});

	it('an account without enough credit: refused, with what it has and what a day takes', async () => {
		const aleph = fakeAleph({ credits: 0 });
		const refused = await keepBackup({
			bytes: text('a sealed backup'),
			name: 'x.backup',
			owner: OWNER,
			alephKey: opened.values.alephKey,
			endpoints,
			fetch: /** @type {any} */ (aleph.fetchImpl),
			settle: { timeout: 10, interval: 1 }
		}).catch((error) => error);
		expect(refused).toBeInstanceOf(BackupRefusedError);
		expect(refused.kind).toBe('credits');
		expect(refused.reason).toEqual({ credits: 0, required: 54 });
	});

	it('reads the grant and the credits of the paying account', async () => {
		const address = alephAddressOf(opened.values.alephKey);
		const granted = fakeAleph({
			credits: 1234.5,
			grants: [
				{
					address: address.toLowerCase(),
					types: ['STORE'],
					channels: [BACKUP_CHANNEL],
					chain: 'ETH'
				}
			]
		});
		expect(
			await isGranted({
				owner: OWNER,
				address,
				endpoints,
				fetch: /** @type {any} */ (granted.fetchImpl)
			})
		).toBe(true);
		expect(
			await creditsOf({ owner: OWNER, endpoints, fetch: /** @type {any} */ (granted.fetchImpl) })
		).toBe(1234.5);

		const otherChannel = fakeAleph({
			credits: 0,
			grants: [{ address, types: ['STORE'], channels: ['BELEGE-BACKUP'] }]
		});
		expect(
			await isGranted({
				owner: OWNER,
				address,
				endpoints,
				fetch: /** @type {any} */ (otherChannel.fetchImpl)
			})
		).toBe(false);
		const none = fakeAleph({ credits: 0 });
		expect(
			await isGranted({
				owner: OWNER,
				address,
				endpoints,
				fetch: /** @type {any} */ (none.fetchImpl)
			})
		).toBe(false);
	});
});

describe('finding the backup on an empty device', () => {
	const OWNER = toChecksumAddress(`0x${'ab'.repeat(20)}`);

	it('asks Aleph for the paying account’s backups on INVOICE-BACKUP, by owner', async () => {
		/** @type {string[]} */ const asked = [];
		const fetchImpl = async (/** @type {string} */ url) => {
			asked.push(url);
			return {
				ok: true,
				status: 200,
				json: async () => ({
					messages: [
						{
							item_hash: 'h1',
							sender: '0x1111111111111111111111111111111111111111',
							channel: BACKUP_CHANNEL,
							content: { address: OWNER, item_type: 'ipfs', item_hash: 'QmOne', time: 10 }
						}
					],
					pagination_total: 1
				})
			};
		};
		const stores = await findBackups({
			owner: OWNER,
			endpoints: { ingestUrl: '', apiHost: 'https://aleph.test', gateways: [] },
			fetch: /** @type {any} */ (fetchImpl)
		});
		expect(stores.map((s) => s.cid)).toEqual(['QmOne']);
		const url = new URL(asked[0]);
		expect(url.searchParams.get('owners')).toBe(OWNER);
		expect(url.searchParams.get('channels')).toBe(BACKUP_CHANNEL);
	});

	it('takes the newest backup this passkey has a slot in, skipping others’ and unreadable ones', async () => {
		const ours = await buildBackup({
			databases: storeA.databases(),
			vault: opened.vault,
			backupKey: opened.values.backupKey
		});
		// A backup of other books: another passkey's vault in front.
		const elsewhere = memoryStorage();
		const otherKey = {
			prfOutput: crypto.getRandomValues(new Uint8Array(32)),
			rawCredentialId: crypto.getRandomValues(new Uint8Array(16))
		};
		const other = await ensureBackupKeys(
			await ensureBooksSecret(await openBooksVault({ ...otherKey, storage: elsewhere }), elsewhere),
			elsewhere
		);
		const theirs = await buildBackup({
			databases: storeA.databases(),
			vault: other.vault,
			backupKey: /** @type {Uint8Array} */ (other.values.backupKey)
		});
		/** @type {Record<string, Uint8Array>} */
		const files = { QmTheirs: theirs.bytes, QmOurs: ours.bytes, QmBroken: text('not a backup') };
		const fetchBytes = async (/** @type {string} */ cid) => {
			if (cid === 'QmGone') throw new Error('404');
			return files[cid];
		};
		const stores = [
			{ cid: 'QmTheirs', time: 400 },
			{ cid: 'QmGone', time: 300 },
			{ cid: 'QmBroken', time: 250 },
			{ cid: 'QmOurs', time: 200 },
			{ cid: 'QmOlder', time: 100 }
		];

		const found = await pickBackup({
			stores,
			rawCredentialId: passkeyA.rawCredentialId,
			fetchBytes
		});
		expect(found.unreachable).toBe(2);
		expect(found.picked?.cid).toBe('QmOurs');
		expect(found.picked?.at).toBe(new Date(200_000).toISOString());
		expect(found.picked?.vault).toEqual(opened.vault);

		const none = await pickBackup({
			stores,
			rawCredentialId: crypto.getRandomValues(new Uint8Array(16)),
			fetchBytes
		});
		expect(none.picked).toBeNull();
	});
});
