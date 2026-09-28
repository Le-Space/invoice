// The invoice extension between two real libp2p nodes (in-memory transport,
// Noise, Yamux, identify): this app's provider on a memory store, and a
// consumer from @le-space/ucep as Belege will use it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLibp2p } from 'libp2p';
import { memory } from '@libp2p/memory';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify, identifyPush } from '@libp2p/identify';
import { createConsumer } from '@le-space/ucep';
import { t } from '../i18n/index.js';
import { SCOPES, createInvoiceProvider, eigenbelegFile, invoiceCommands } from './provider.js';
import { LAST_USED_EVERY_MS, collectionKeyValue, onlyRecentlyUsed } from './store.js';

/** A collection that keeps records in memory, the way store/repository.js does. */
function memoryCollection() {
	/** @type {Map<string, any>} */
	const records = new Map();
	/** @type {Set<() => void>} */
	const listeners = new Set();
	let next = 0;
	return {
		async put(/** @type {any} */ input) {
			const id = input.id ?? `01J${String(next++).padStart(23, '0')}`;
			const record = { deleted: false, ...(records.get(id) ?? {}), ...input, id };
			records.set(id, record);
			for (const l of listeners) l();
			return record;
		},
		onChange(/** @type {() => void} */ listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async get(/** @type {string} */ id) {
			return records.get(id) ?? null;
		},
		async list({ where = null, includeDeleted = false } = {}) {
			const all = [...records.values()].filter((r) => includeDeleted || !r.deleted);
			return where ? all.filter(where) : all;
		},
		async softDelete(/** @type {string} */ id) {
			records.set(id, { ...records.get(id), deleted: true });
			for (const l of listeners) l();
		}
	};
}

async function node(/** @type {string} */ name) {
	return createLibp2p({
		addresses: { listen: [`/memory/${name}-${Math.random().toString(36).slice(2)}`] },
		transports: [memory()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: { identify: identify(), identifyPush: identifyPush() }
	});
}

/** The spec's example (extensions/invoice.md), made-up data. */
const args = {
	date: '2026-09-01',
	direction: 'outgoing',
	reason: 'Das Netzwerk berechnet Gebühren on-chain und stellt keine Rechnung aus.',
	description: 'Netzwerkgebühr für eine Lease-Zahlung',
	amount: { value: '12.34', currency: 'EUR' },
	crypto: {
		chain: 'cosmos:akashnet-2',
		symbol: 'AKT',
		quantity: '4.200000',
		txRef: '0'.repeat(64),
		valuation: { rate: '2.938095', source: 'coingecko:history', at: '2026-09-01T12:00:00+00:00' }
	},
	reference: { system: 'belege', id: '01J0000000000000000000000A' }
};

const store = { invoices: memoryCollection(), settings: memoryCollection() };
let settings = /** @type {any} */ ({
	issuer: { name: 'Wolkenfabrik Hosting UG', address: 'Musterstraße 1\n12345 Musterstadt' }
});
/** @type {any} */ let providerNode;
/** @type {any} */ let consumerNode;
/** @type {any} */ let strangerNode;
/** @type {any} */ let provider;
/** @type {any} */ let consumer;
/** @type {any} */ let stranger;
/** @type {string} */ let providerId;

beforeAll(async () => {
	[providerNode, consumerNode, strangerNode] = await Promise.all([
		node('invoice'),
		node('belege'),
		node('stranger')
	]);
	provider = createInvoiceProvider({
		libp2p: providerNode,
		store: /** @type {any} */ (store),
		settings: () => settings,
		t,
		now: () => new Date('2026-09-26T10:00:00+02:00')
	});
	await provider.start();
	consumer = createConsumer({ libp2p: consumerNode, label: 'Belege, Laptop' });
	stranger = createConsumer({ libp2p: strangerNode, label: 'Fremd' });
	await consumer.start();
	await stranger.start();
	providerId = providerNode.peerId.toString();
});

afterAll(async () => {
	await Promise.all([providerNode?.stop(), consumerNode?.stop(), strangerNode?.stop()]);
});

describe('the invoice extension, served', () => {
	it('lists what it serves to anybody, and serves nothing else to a stranger', async () => {
		await stranger.addProvider(providerNode.getMultiaddrs()[0].toString());
		const help = await stranger.call(providerId, 'invoice', 'help', {});
		expect(help.commands.map((/** @type {any} */ c) => c.name)).toEqual([
			'help',
			'create-eigenbeleg',
			'status',
			'get-pdf'
		]);
		await expect(
			stranger.call(providerId, 'invoice', 'create-eigenbeleg', args)
		).rejects.toMatchObject({ code: 'PAIRING_REQUIRED' });
	});

	it('makes an Eigenbeleg for a paired app, numbered in its own range, and keeps the grant sealed', async () => {
		const { uri } = await provider.createInvitation({ scopes: [SCOPES.eigenbeleg, SCOPES.read] });
		await consumer.pairWithInvitation(uri);
		expect((await store.settings.list()).some((r) => r.key.startsWith('ucep/grant/'))).toBe(true);

		const created = await consumer.call(providerId, 'invoice', 'create-eigenbeleg', args);
		expect(created).toMatchObject({ number: 'EB-2026-0001', state: 'created' });
		expect(created.file).toMatchObject({
			mime: 'application/pdf',
			cid: expect.stringMatching(/^bafk/)
		});
		expect(created.file.sha256).toMatch(/^[0-9a-f]{64}$/);

		const record = await store.invoices.get(created.documentId);
		expect(record).toMatchObject({
			kind: 'eigenbeleg',
			number: 'EB-2026-0001',
			reference: { system: 'belege', id: '01J0000000000000000000000A' },
			requestedBy: { label: 'Belege, Laptop' }
		});

		const again = await consumer.call(providerId, 'invoice', 'create-eigenbeleg', args);
		expect(again.number).toBe('EB-2026-0002');
	});

	it('tells the state and hands over the PDF, the same bytes every time', async () => {
		const created = await consumer.call(providerId, 'invoice', 'create-eigenbeleg', args);
		const status = await consumer.call(providerId, 'invoice', 'status', {
			documentId: created.documentId
		});
		expect(status).toMatchObject({ kind: 'eigenbeleg', state: 'created', number: created.number });
		expect(status.file.sha256).toBe(created.file.sha256);

		// A direct connection: the PDF comes inline.
		const pdf = await consumer.call(providerId, 'invoice', 'get-pdf', {
			documentId: created.documentId
		});
		const bytes = Uint8Array.from(atob(pdf.base64), (c) => c.charCodeAt(0));
		expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
		expect(bytes.byteLength).toBe(created.file.size);
		const local = await eigenbelegFile(await store.invoices.get(created.documentId), t);
		expect(local.meta.sha256).toBe(created.file.sha256);
	});

	it('refuses arguments with problems, naming the field', async () => {
		await expect(
			consumer.call(providerId, 'invoice', 'create-eigenbeleg', { ...args, reason: '' })
		).rejects.toMatchObject({
			code: 'INVALID_ARGUMENTS',
			message: expect.stringMatching(/^reason/)
		});
		await expect(
			consumer.call(providerId, 'invoice', 'create-eigenbeleg', {
				...args,
				amount: { value: 12.34, currency: 'EUR' }
			})
		).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
	});

	it('says nothing about a document made under another grant, or none', async () => {
		const created = await consumer.call(providerId, 'invoice', 'create-eigenbeleg', args);
		const { uri } = await provider.createInvitation({ scopes: [SCOPES.read] });
		await stranger.pairWithInvitation(uri);
		for (const documentId of [created.documentId, 'no-such-document']) {
			await expect(
				stranger.call(providerId, 'invoice', 'status', { documentId })
			).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
		}
		// Read only: no scope to make one.
		await expect(
			stranger.call(providerId, 'invoice', 'create-eigenbeleg', args)
		).rejects.toMatchObject({ code: 'SCOPE_MISSING' });
	});

	it('makes none while the app has no issuer', async () => {
		settings = { issuer: { name: '', address: '' } };
		await expect(
			consumer.call(providerId, 'invoice', 'create-eigenbeleg', args)
		).rejects.toMatchObject({ code: 'UNAVAILABLE' });
	});

	it('forgets a revoked grant', async () => {
		const [grant] = (await provider.grants()).filter(
			(/** @type {any} */ g) => g.label === 'Belege, Laptop'
		);
		await provider.revoke(grant.grantId);
		await expect(
			consumer.call(providerId, 'invoice', 'status', { documentId: 'x' })
		).rejects.toMatchObject({ code: 'PAIRING_REQUIRED' });
	});
});

describe('create-eigenbeleg, called directly', () => {
	const issuer = { name: 'Stromwerk Test AG', address: 'Teststraße 2\n54321 Probestadt' };
	/** @param {any} invoices */
	const commands = (invoices) =>
		invoiceCommands({
			store: /** @type {any} */ ({ invoices }),
			settings: () => ({ issuer }),
			t,
			now: () => new Date('2026-09-26T10:00:00+02:00')
		});
	const grantA = { grantId: 'grant-a', label: 'Belege A', did: '' };
	const grantB = { grantId: 'grant-b', label: 'Belege B', did: '' };
	/** @param {any} c @param {any} grant @param {string} requestId */
	const create = (c, grant, requestId) =>
		c['create-eigenbeleg'].handler({ argsJson: args, grant, peerId: 'peer', requestId });

	it('numbers calls that arrive together one after another, never twice', async () => {
		const c = commands(memoryCollection());
		const made = await Promise.all([
			create(c, grantA, 'a-1'),
			create(c, grantA, 'a-2'),
			create(c, grantB, 'b-1'),
			create(c, grantB, 'b-2')
		]);
		expect(new Set(made.map((m) => m.number)).size).toBe(4);
	});

	it('answers a request it answered before with the same Eigenbeleg, also after a reload', async () => {
		const invoices = memoryCollection();
		const first = await create(commands(invoices), grantA, 'belege-eigenbeleg-1');
		// Another run of the app on the same books: the library's memory is gone.
		const again = await create(commands(invoices), grantA, 'belege-eigenbeleg-1');
		expect(again).toEqual(first);
		// A retry while the first call still runs, in the same app.
		const running = commands(invoices);
		const both = await Promise.all([
			create(running, grantA, 'belege-eigenbeleg-2'),
			create(running, grantA, 'belege-eigenbeleg-2')
		]);
		expect(both[0].documentId).toBe(both[1].documentId);
		expect((await invoices.list()).length).toBe(2);
		// Another grant with the same request id: its own.
		const other = await create(commands(invoices), grantB, 'belege-eigenbeleg-1');
		expect(other.documentId).not.toBe(first.documentId);
	});
});

describe('the grant store', () => {
	const grant = { grantId: 'g', scopes: ['invoice:document:read'], lastUsedAt: 1_000 };

	it('writes a lastUsedAt alone at most once an hour', async () => {
		expect(onlyRecentlyUsed(grant, { ...grant, lastUsedAt: 2_000 })).toBe(true);
		expect(onlyRecentlyUsed(grant, { ...grant, lastUsedAt: 1_000 + LAST_USED_EVERY_MS })).toBe(
			false
		);
		expect(onlyRecentlyUsed(grant, { ...grant, scopes: [], lastUsedAt: 2_000 })).toBe(false);

		const settings = memoryCollection();
		const grants = collectionKeyValue(/** @type {any} */ (settings), 'ucep/grant/');
		await grants.set('g', grant);
		for (let i = 1; i <= 50; i++) await grants.set('g', { ...grant, lastUsedAt: 1_000 + i });
		expect((await settings.list({ includeDeleted: true })).length).toBe(1);
		expect(await grants.get('g')).toEqual(grant);
	});

	it('reads the settings again once they change, and not before', async () => {
		const settings = memoryCollection();
		let reads = 0;
		const counted = /** @type {any} */ ({
			...settings,
			list: (/** @type {any} */ o) => {
				reads++;
				return settings.list(o);
			}
		});
		const grants = collectionKeyValue(counted, 'ucep/grant/');
		await grants.set('g', grant);
		const before = reads;
		for (let i = 0; i < 20; i++) await grants.get('g');
		expect(reads - before).toBe(1);
		// A write from elsewhere (another tab, a sync): read anew.
		await settings.put({ key: 'ucep/grant/h', value: { ...grant, grantId: 'h' } });
		expect((await grants.values()).map((g) => g.grantId).sort()).toEqual(['g', 'h']);
		await grants.delete('g');
		expect(await grants.get('g')).toBeUndefined();
	});
});
