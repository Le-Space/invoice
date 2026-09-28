import { describe, expect, it } from 'vitest';
import de from '../i18n/de.json';
import { documentLabels } from './labels.js';
import { PDFName } from 'pdf-lib';
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
	bank: { name: 'Testbank', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' },
	crypto: {
		btc: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
		eth: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
	},
	register: {
		court: 'Amtsgericht Musterstadt',
		number: 'HRB 00000',
		managingDirector: 'Erika Mustermann'
	},
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
				unitPrice: '50000'
			}),
			emptyLine({
				description: 'Fahrtkosten',
				quantity: 1,
				unit: 'Pauschale',
				unitPrice: '4500'
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

	it('carries its own letters, so no viewer substitutes any', async () => {
		// The whole reason the font is embedded: a substituted Helvetica drew
		// the euro sign wider than its metrics and swallowed the space after it.
		const { PDFDocument } = await import('pdf-lib');
		const bytes = await invoicePdfBytes(invoice, LABELS);
		const loaded = await PDFDocument.load(bytes);
		const resources = /** @type {any} */ (loaded.getPages()[0].node.Resources());
		const fonts = /** @type {any} */ (resources.lookup(PDFName.of('Font')));
		const names = fonts.entries().map((/** @type {any[]} */ entry) => String(entry[0]));
		expect(names.some((/** @type {string} */ name) => name.includes('DejaVu'))).toBe(true);
	});

	it('prints a name the standard fonts would have turned into question marks', async () => {
		// "?ukasz Wi?niewski" on a document that is evidence.
		const polish = {
			...invoice,
			customer: { name: 'Łukasz Wiśniewski', address: 'Kraków', vatId: '' }
		};
		const bytes = await invoicePdfBytes(polish, LABELS);
		expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
		expect(bytes.byteLength).toBeGreaterThan(5000);
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

	it('prints an invoice in USDC, one in Ether with all eighteen decimals, and one in NYM of before', async () => {
		const rate = { eurPerUnit: '0.9123', source: 'Kraken', date: '2026-09-24' };
		/** @type {any[]} */
		const invoices = [];
		for (const [currency, unitPrice] of [
			['USDC', '1500000'],
			['ETH', '123456789']
		]) {
			const draft = {
				...emptyDraft({ currency, issueDate: '2026-09-24' }),
				eurRate: rate,
				customer: invoice.customer,
				lines: [emptyLine({ description: 'Serverbetrieb', quantity: 3, unitPrice })]
			};
			invoices.push(issue(draft, { number: '2026-48213-002', issuer: ISSUER, issuedBy: 'did' }));
		}
		// Issued while NYM was still offered, with a NYM address frozen into its
		// issuer (a Cosmos address made of zero bytes): it still prints.
		invoices.push({
			...invoices[0],
			currency: 'NYM',
			network: 'nyx',
			issuer: {
				...ISSUER,
				crypto: { ...ISSUER.crypto, nym: 'n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp8hacc' }
			}
		});
		for (const issued of invoices) {
			const bytes = await invoicePdfBytes(issued, LABELS);
			expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
		}
	});

	it('names the file after the invoice', () => {
		expect(invoiceFileName(invoice)).toBe('Rechnung-2026-48213-001.pdf');
		expect(invoiceFileName({})).toBe('Rechnung-Entwurf.pdf');
	});
});
