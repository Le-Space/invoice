import { describe, expect, it } from 'vitest';
import de from '../i18n/de.json';
import { documentLabels } from './labels.js';
import { invoiceFileName, invoicePdfBytes } from './pdf.js';
import { emptyDraft, emptyLine, issue } from './records.js';

/** The real catalogue, so a key the document needs and nobody translated fails here. */
const catalogue = /** @type {any} */ ({ invoice: de.invoice });
const LABELS = documentLabels(
	(/** @type {string} */ key) =>
		key.split('.').reduce((/** @type {any} */ node, part) => node?.[part], catalogue) ?? ''
);

const ISSUER = {
	name: 'Wolkenfabrik Hosting UG (haftungsbeschränkt)',
	address: 'Musterstraße 1\n12345 Musterstadt',
	vatId: 'DE000000000',
	taxNumber: '',
	email: 'buchhaltung@example.org',
	phone: '+49 000 0000',
	web: 'https://example.org',
	bank: { name: 'Testbank', iban: 'DE89370400440532013000', bic: 'TESTDEFFXXX' },
	crypto: { btc: 'bc1qexample', eth: '' },
	register: { court: 'Amtsgericht Musterstadt', number: 'HRB 00000', managingDirector: 'Erika Mustermann' },
	logo: ''
};

const invoice = issue(
	{
		...emptyDraft({ issueDate: '2026-09-24' }),
		customer: { name: 'Müller & Söhne GmbH', address: 'Kölner Straße 1\n50667 Köln', vatId: '' },
		lines: [
			emptyLine({
				description: 'Tagessatz — Beratung',
				quantity: 2,
				unit: 'Tage',
				unitPriceCents: 50_000
			}),
			emptyLine({
				description: 'Fahrtkosten',
				quantity: 1,
				unit: 'Pauschale',
				unitPriceCents: 4500
			})
		],
		notes: 'Vielen Dank für die Zusammenarbeit.'
	},
	{ number: '2026-48213-001', issuer: ISSUER, issuedBy: 'did:key:z6Mkha' }
);

describe('invoicePdfBytes', () => {
	it('makes a PDF', async () => {
		const bytes = await invoicePdfBytes(invoice, LABELS);
		expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
		expect(bytes.byteLength).toBeGreaterThan(1000);
	});

	it('draws the GiroCode, which is the biggest thing on the page', async () => {
		// The code is thousands of little rectangles; without an IBAN there is
		// no code, and the file is markedly smaller.
		const withCode = await invoicePdfBytes(invoice, LABELS);
		const without = await invoicePdfBytes(
			{ ...invoice, issuer: { ...ISSUER, bank: { name: '', iban: '', bic: '' } } },
			LABELS
		);
		expect(withCode.byteLength).toBeGreaterThan(without.byteLength);
	});

	it('takes a logo, and shrugs off one it cannot read', async () => {
		// 1×1 transparent PNG.
		const png =
			'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
		const withLogo = await invoicePdfBytes(
			{ ...invoice, issuer: { ...ISSUER, logo: png } },
			LABELS
		);
		expect(withLogo.byteLength).toBeGreaterThan(1000);

		const broken = await invoicePdfBytes(
			{ ...invoice, issuer: { ...ISSUER, logo: 'data:image/png;base64,not-a-png' } },
			LABELS
		);
		expect(new TextDecoder().decode(broken.slice(0, 5))).toBe('%PDF-');
	});

	it('survives the characters people actually paste', async () => {
		// An em dash and an umlaut are not exotic; Helvetica refuses what it
		// cannot encode, and a refused export is a broken invoice.
		const bytes = await invoicePdfBytes(
			{ ...invoice, notes: 'Bezeichnung — „Sonderfall" ≈ 100 % · Größe' },
			LABELS
		);
		expect(bytes.byteLength).toBeGreaterThan(1000);
	});

	it('names the file after the invoice', () => {
		expect(invoiceFileName(invoice)).toBe('Rechnung-2026-48213-001.pdf');
		expect(invoiceFileName({})).toBe('Rechnung-Entwurf.pdf');
	});
});
