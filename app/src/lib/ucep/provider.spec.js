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
import { cancellationFor, emptyDraft, emptyLine, issue } from '@le-space/invoice/records';
import { SCOPES, createInvoiceProvider, eigenbelegFile } from './provider.js';

/** A collection that keeps records in memory, the way store/repository.js does. */
function memoryCollection() {
	/** @type {Map<string, any>} */
	const records = new Map();
	let next = 0;
	return {
		async put(/** @type {any} */ input) {
			const id = input.id ?? `01J${String(next++).padStart(23, '0')}`;
			const record = { deleted: false, ...(records.get(id) ?? {}), ...input, id };
			records.set(id, record);
			return record;
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
			'get-pdf',
			'list-issued',
			'record-payment'
		]);
		await expect(
			stranger.call(providerId, 'invoice', 'create-eigenbeleg', args)
		).rejects.toMatchObject({ code: 'PAIRING_REQUIRED' });
		// get-pdf checks its grant itself (two scopes open it), and just as strictly.
		await expect(
			stranger.call(providerId, 'invoice', 'get-pdf', { documentId: 'x' })
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

/** An issued invoice as the app stores it: the store's id, not the core's `inv_…`. */
function issued(/** @type {any} */ { number, issueDate, gross, customer = 'Beispiel Kunde GmbH' }) {
	const draft = {
		...emptyDraft({
			taxMode: 'standard',
			issueDate,
			customer: { name: customer, address: 'Beispielweg 2\n54321 Beispielstadt' }
		}),
		// 100.00 net + 19 % = 119.00; `gross` scales it.
		lines: [emptyLine({ description: 'Beratung', unitPrice: String(gross * 100), vatRate: 19 })]
	};
	const record = issue(draft, {
		number,
		issuer: { name: 'Wolkenfabrik Hosting UG', address: 'Musterstraße 1\n12345 Musterstadt' },
		issuedBy: 'did:key:z6MkInvoiceProviderSpec',
		issuedAt: `${issueDate}T09:00:00.000Z`
	});
	return withoutId(record);
}

/** @param {any} record */
function withoutId(record) {
	const rest = { ...record };
	delete rest.id;
	return rest;
}

describe('issued invoices and their payments (0.2.0)', () => {
	/** @type {any[]} */ const nodes = [];
	/** @type {any} */ let books;
	/** @type {any} */ let reader;
	/** @type {any} */ let recorder;
	/** @type {Record<string, any>} */ const ids = {};

	beforeAll(async () => {
		settings = {
			issuer: { name: 'Wolkenfabrik Hosting UG', address: 'Musterstraße 1\n12345 Musterstadt' }
		};
		const [a, b, c] = await Promise.all([node('books'), node('reader'), node('recorder')]);
		nodes.push(a, b, c);
		books = createConsumer({ libp2p: a, label: 'Belege, Büro' });
		reader = createConsumer({ libp2p: b, label: 'Nur lesen' });
		recorder = createConsumer({ libp2p: c, label: 'Nur melden' });
		for (const consumer of [books, reader, recorder]) await consumer.start();
		const scopesOf = [
			[books, [SCOPES.eigenbeleg, SCOPES.read, SCOPES.issuedRead, SCOPES.paymentRecord]],
			[reader, [SCOPES.issuedRead]],
			[recorder, [SCOPES.paymentRecord]]
		];
		for (const [consumer, scopes] of scopesOf) {
			const { uri } = await provider.createInvitation({ scopes });
			await consumer.pairWithInvitation(uri);
		}

		const put = async (/** @type {any} */ record) => (await store.invoices.put(record)).id;
		ids.first = await put(issued({ number: 'RE-2026-0001', issueDate: '2026-08-01', gross: 100 }));
		ids.second = await put(issued({ number: 'RE-2026-0002', issueDate: '2026-09-01', gross: 100 }));
		ids.third = await put(issued({ number: 'RE-2026-0003', issueDate: '2026-09-10', gross: 50 }));
		ids.cancelled = await put(
			issued({ number: 'RE-2026-0004', issueDate: '2026-09-11', gross: 100 })
		);
		// The Storno of the fourth: an invoice of its own, and the fourth is cancelled.
		const storno = issue(
			{ ...cancellationFor(await store.invoices.get(ids.cancelled), { issueDate: '2026-09-12' }) },
			{
				number: 'RE-2026-0005',
				issuer: settings.issuer,
				issuedBy: 'did:key:z6MkInvoiceProviderSpec',
				issuedAt: '2026-09-12T09:00:00.000Z'
			}
		);
		ids.storno = await put(withoutId(storno));
		ids.draft = await put(withoutId(emptyDraft({ issueDate: '2026-09-05' })));
		ids.eigenbeleg = (
			await books.call(providerId, 'invoice', 'create-eigenbeleg', args)
		).documentId;
	});

	afterAll(async () => {
		await Promise.all(nodes.map((n) => n.stop()));
	});

	it('lists every issued invoice — never a draft, never an Eigenbeleg — page by page', async () => {
		const all = await books.call(providerId, 'invoice', 'list-issued', {});
		expect(all.next).toBeNull();
		expect(all.invoices.map((/** @type {any} */ i) => i.number)).toEqual([
			'RE-2026-0001',
			'RE-2026-0002',
			'RE-2026-0003',
			'RE-2026-0004',
			'RE-2026-0005'
		]);
		const ids_ = all.invoices.map((/** @type {any} */ i) => i.documentId);
		expect(ids_).not.toContain(ids.draft);
		expect(ids_).not.toContain(ids.eigenbeleg);
		expect(all.invoices[1]).toEqual({
			documentId: ids.second,
			number: 'RE-2026-0002',
			state: 'issued',
			issuedOn: '2026-09-01',
			dueOn: '2026-09-15',
			customer: { name: 'Beispiel Kunde GmbH' },
			total: { value: '119.00', currency: 'EUR' },
			paid: { value: '0.00', currency: 'EUR' },
			payments: []
		});
		expect(all.invoices[3]).toMatchObject({ number: 'RE-2026-0004', state: 'cancelled' });
		expect(all.invoices[4]).toMatchObject({
			number: 'RE-2026-0005',
			state: 'issued',
			total: { value: '-119.00', currency: 'EUR' }
		});
		expect(all.invoices[4].dueOn).toBeUndefined();

		// Two at a time, from the cursor.
		const first = await reader.call(providerId, 'invoice', 'list-issued', { limit: 2 });
		expect(first.invoices.map((/** @type {any} */ i) => i.number)).toEqual([
			'RE-2026-0001',
			'RE-2026-0002'
		]);
		expect(typeof first.next).toBe('string');
		const second = await reader.call(providerId, 'invoice', 'list-issued', {
			limit: 2,
			cursor: first.next
		});
		expect(second.invoices.map((/** @type {any} */ i) => i.number)).toEqual([
			'RE-2026-0003',
			'RE-2026-0004'
		]);
		const last = await reader.call(providerId, 'invoice', 'list-issued', {
			limit: 2,
			cursor: second.next
		});
		expect(last.invoices.map((/** @type {any} */ i) => i.number)).toEqual(['RE-2026-0005']);
		expect(last.next).toBeNull();

		// From an issue date on.
		const since = await reader.call(providerId, 'invoice', 'list-issued', { since: '2026-09-10' });
		expect(since.invoices.map((/** @type {any} */ i) => i.number)).toEqual([
			'RE-2026-0003',
			'RE-2026-0004',
			'RE-2026-0005'
		]);

		for (const bad of [
			{ limit: 201 },
			{ limit: 0 },
			{ limit: '10' },
			{ since: '1.9.2026' },
			{ cursor: 'x' }
		]) {
			await expect(reader.call(providerId, 'invoice', 'list-issued', bad)).rejects.toMatchObject({
				code: 'INVALID_ARGUMENTS'
			});
		}
	});

	it('hands over the PDF of an issued invoice under invoice:issued:read, the same bytes every time', async () => {
		const pdf = await reader.call(providerId, 'invoice', 'get-pdf', { documentId: ids.second });
		const bytes = Uint8Array.from(atob(pdf.base64), (c) => c.charCodeAt(0));
		expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
		expect(pdf).toMatchObject({ mime: 'application/pdf', size: bytes.byteLength });
		const again = await books.call(providerId, 'invoice', 'get-pdf', { documentId: ids.second });
		expect(again.sha256).toBe(pdf.sha256);
		// A cancelled invoice is still an issued document; a draft and an Eigenbeleg are not.
		await expect(
			reader.call(providerId, 'invoice', 'get-pdf', { documentId: ids.cancelled })
		).resolves.toMatchObject({ mime: 'application/pdf' });
		for (const documentId of [ids.draft, ids.eigenbeleg, 'no-such-document']) {
			await expect(
				reader.call(providerId, 'invoice', 'get-pdf', { documentId })
			).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
		}
		// Its own Eigenbeleg still comes under invoice:document:read.
		const own = await books.call(providerId, 'invoice', 'get-pdf', { documentId: ids.eigenbeleg });
		expect(own.mime).toBe('application/pdf');
	});

	it('refuses an issued invoice’s PDF without invoice:issued:read', async () => {
		// The stranger holds invoice:document:read only: documents of its own grant.
		await expect(
			stranger.call(providerId, 'invoice', 'get-pdf', { documentId: ids.second })
		).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
		// Neither read scope at all.
		await expect(
			recorder.call(providerId, 'invoice', 'get-pdf', { documentId: ids.second })
		).rejects.toMatchObject({ code: 'SCOPE_MISSING' });
	});

	it('records, replaces and removes payments by their reference', async () => {
		const before = await store.invoices.get(ids.first);
		const ref = (/** @type {string} */ id) => ({ system: 'belege', id });
		const pay = (/** @type {any} */ more) =>
			recorder.call(providerId, 'invoice', 'record-payment', { documentId: ids.first, ...more });

		// A part payment.
		expect(
			await pay({
				paidOn: '2026-08-10',
				amount: { value: '50.00', currency: 'EUR' },
				reference: ref('01J0000000000000000000000D')
			})
		).toEqual({
			documentId: ids.first,
			paid: { value: '50.00', currency: 'EUR' },
			open: { value: '69.00', currency: 'EUR' },
			state: 'partially-paid'
		});
		// The same reference again replaces it.
		expect(
			await pay({
				paidOn: '2026-08-12',
				amount: { value: '119', currency: 'EUR' },
				reference: ref('01J0000000000000000000000D')
			})
		).toMatchObject({ paid: { value: '119.00' }, open: { value: '0.00' }, state: 'paid' });
		// Another payment on top: overpaid.
		expect(
			await pay({
				paidOn: '2026-08-15',
				amount: { value: '0.01', currency: 'EUR' },
				reference: ref('01J0000000000000000000000E')
			})
		).toMatchObject({ paid: { value: '119.01' }, open: { value: '0.00' }, state: 'overpaid' });
		// Unlinked: gone.
		expect(await pay({ paidOn: null, reference: ref('01J0000000000000000000000E') })).toMatchObject(
			{ paid: { value: '119.00' }, state: 'paid' }
		);

		// Only the payments changed on the issued invoice.
		const after = await store.invoices.get(ids.first);
		const { payments, ...rest } = after;
		expect(rest).toEqual(before);
		expect(payments).toEqual([
			expect.objectContaining({
				paidOn: '2026-08-12',
				units: '11900',
				reference: ref('01J0000000000000000000000D'),
				recordedBy: { label: 'Nur melden' }
			})
		]);

		// And the list says so.
		const listed = (await books.call(providerId, 'invoice', 'list-issued', {})).invoices.find(
			(/** @type {any} */ i) => i.documentId === ids.first
		);
		expect(listed.paid).toEqual({ value: '119.00', currency: 'EUR' });
		expect(listed.payments).toEqual([
			{
				paidOn: '2026-08-12',
				amount: { value: '119.00', currency: 'EUR' },
				reference: ref('01J0000000000000000000000D')
			}
		]);
	});

	it('refuses a payment in another currency, on a cancelled invoice, or on none', async () => {
		const payment = {
			paidOn: '2026-09-12',
			amount: { value: '119.00', currency: 'EUR' },
			reference: { system: 'belege', id: '01J0000000000000000000000F' }
		};
		await expect(
			books.call(providerId, 'invoice', 'record-payment', {
				...payment,
				documentId: ids.second,
				amount: { value: '119.00', currency: 'USD' }
			})
		).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS', message: /^amount\.currency/ });
		for (const amount of [
			{ value: 119, currency: 'EUR' },
			{ value: '119.001', currency: 'EUR' },
			{ value: '0.00', currency: 'EUR' },
			{ value: '-1.00', currency: 'EUR' }
		]) {
			await expect(
				books.call(providerId, 'invoice', 'record-payment', {
					...payment,
					documentId: ids.second,
					amount
				})
			).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS', message: /^amount\.value/ });
		}
		await expect(
			books.call(providerId, 'invoice', 'record-payment', {
				...payment,
				documentId: ids.second,
				paidOn: '2026-02-30'
			})
		).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS', message: /^paidOn/ });

		// Cancelled, a Storno, a draft, an Eigenbeleg, unknown: one and the same answer.
		/** @type {string[]} */
		const messages = [];
		for (const documentId of [
			ids.cancelled,
			ids.storno,
			ids.draft,
			ids.eigenbeleg,
			'01J9999999999999999999999Z'
		]) {
			const error = await books
				.call(providerId, 'invoice', 'record-payment', { ...payment, documentId })
				.catch((/** @type {any} */ e) => e);
			expect(error).toMatchObject({ code: 'INVALID_ARGUMENTS' });
			messages.push(error.message);
		}
		expect(new Set(messages).size).toBe(1);
		expect(messages[0]).toMatch(/^documentId/);
		expect((await store.invoices.get(ids.cancelled)).payments).toBeUndefined();
	});

	it('needs the scope for each command', async () => {
		await expect(
			reader.call(providerId, 'invoice', 'record-payment', {
				documentId: ids.second,
				paidOn: '2026-09-12',
				amount: { value: '119.00', currency: 'EUR' },
				reference: { system: 'belege', id: '01J0000000000000000000000G' }
			})
		).rejects.toMatchObject({ code: 'SCOPE_MISSING' });
		await expect(recorder.call(providerId, 'invoice', 'list-issued', {})).rejects.toMatchObject({
			code: 'SCOPE_MISSING'
		});
		await expect(stranger.call(providerId, 'invoice', 'list-issued', {})).rejects.toMatchObject({
			code: 'SCOPE_MISSING'
		});
	});

	it('offers the new scopes in its manifest, so an app can pair for them', async () => {
		await expect(
			provider.createInvitation({ scopes: [SCOPES.issuedRead, SCOPES.paymentRecord] })
		).resolves.toMatchObject({ uri: expect.stringMatching(/^web\+ucep:pair\?/) });
	});
});
