import { describe, expect, it } from 'vitest';
import { normaliseInvoiceSettings } from '@le-space/invoice/settings';
import { emptyLine } from '@le-space/invoice/records';
import { createDraft, draftCancellation, issueDraft, saveDraft, saveSettings } from './invoices.js';

/** A collection that keeps records in memory, the way store/repository.js does. */
function memoryCollection() {
	/** @type {Map<string, any>} */
	const records = new Map();
	let next = 0;
	return {
		async put(/** @type {any} */ input) {
			const id = input.id ?? `01J${String(next++).padStart(23, '0')}`;
			const record = { ...(records.get(id) ?? {}), ...input, id };
			records.set(id, record);
			return record;
		},
		async get(/** @type {string} */ id) {
			return records.get(id) ?? null;
		},
		async list({ where = null } = {}) {
			const all = [...records.values()];
			return where ? all.filter(where) : all;
		}
	};
}

const DID = 'did:key:z6MkInvoiceAppSpec';
const store = /** @type {any} */ ({ invoices: memoryCollection(), settings: memoryCollection() });
const settings = normaliseInvoiceSettings(
	{
		issuer: {
			name: 'Wolkenfabrik Hosting UG',
			address: 'Musterstraße 1\n12345 Musterstadt',
			crypto: { nym: 'n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp8hacc' }
		},
		taxMode: 'kleinunternehmer'
	},
	DID
);
const customer = { name: 'Stromwerk Test AG', address: 'Beispielweg 2\n54321 Beispielstadt' };

describe('the invoice actions', () => {
	it('create a draft with the store’s id and the settings’ tax mode', async () => {
		const draft = await createDraft(store, settings);
		expect(draft.id).toMatch(/^01J/);
		expect(draft).toMatchObject({ state: 'draft', taxMode: 'kleinunternehmer', currency: 'EUR' });
	});

	it('set a draft up for a chain from a template', async () => {
		const draft = await createDraft(store, settings, { templateId: 'nym-node' });
		expect(draft).toMatchObject({
			currency: 'NYM',
			network: 'nyx',
			chainTemplate: 'nym-node',
			lines: [expect.objectContaining({ description: 'Betrieb eines Nym-Knotens' })]
		});
	});

	it('issue a draft with the next number of this passkey’s circle, and never rewrite it', async () => {
		const draft = await createDraft(store, settings, { templateId: 'nym-node' });
		const ready = await saveDraft(store, {
			...draft,
			customer,
			lines: [{ ...draft.lines[0], unitPrice: '12500000' }]
		});
		const now = new Date('2026-09-26T10:00:00Z');
		const issued = await issueDraft(store, { draft: ready, settings, did: DID, invoices: [], now });
		expect(issued.state).toBe('issued');
		expect(issued.id).toBe(draft.id);
		expect(issued.number).toMatch(/^2026-\d{5}-001$/);
		expect(issued.template).toContain('Nym-Netzwerk');
		await expect(saveDraft(store, { ...issued, notes: 'changed' })).rejects.toThrow(
			/not rewritten/
		);

		const second = await createDraft(store, settings);
		const next = await issueDraft(store, {
			draft: await saveDraft(store, {
				...second,
				customer,
				lines: [emptyLine({ description: 'Beratung', unitPrice: '10000' })]
			}),
			settings,
			did: DID,
			invoices: [issued],
			now
		});
		expect(next.number).toMatch(/-002$/);
	});

	it('refuse to issue a draft with problems', async () => {
		const draft = await createDraft(store, settings);
		await expect(issueDraft(store, { draft, settings, did: DID, invoices: [] })).rejects.toThrow(
			/not ready/
		);
	});

	it('draft a Storno that cancels the issued invoice', async () => {
		const draft = await createDraft(store, settings);
		const issued = await issueDraft(store, {
			draft: await saveDraft(store, {
				...draft,
				customer,
				lines: [emptyLine({ description: 'Beratung', unitPrice: '10000' })]
			}),
			settings,
			did: DID,
			invoices: []
		});
		const storno = await draftCancellation(store, issued);
		expect(storno).toMatchObject({ state: 'draft', cancels: issued.number });
		expect(storno.id).not.toBe(issued.id);
		expect(storno.lines[0].quantity).toBe(-1);
	});

	it('keep the settings under one key', async () => {
		await saveSettings(store, settings);
		const [record] = await store.settings.list();
		expect(record).toMatchObject({ key: 'invoice', value: settings });
	});
});
