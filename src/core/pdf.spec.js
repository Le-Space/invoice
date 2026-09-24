import { describe, expect, it } from 'vitest';
import { invoiceFileName, invoicePdfBytes } from './pdf.js';
import { emptyDraft, emptyLine, issue } from './records.js';

const LABELS = {
	title: 'Rechnung',
	titleCancellation: 'Stornorechnung',
	invoiceDate: 'Rechnungsdatum',
	deliveryDate: 'Leistungsdatum',
	position: 'Pos.',
	description: 'Beschreibung',
	quantity: 'Menge',
	unitPrice: 'Einzelpreis',
	vat: 'USt',
	lineNet: 'Netto',
	netTotal: 'Zwischensumme netto',
	grossTotal: 'Gesamtbetrag',
	vatId: 'USt-IdNr',
	iban: 'IBAN',
	paymentTerms: 'Zahlbar ohne Abzug bis zum {date}.',
	paymentOnReceipt: 'Zahlbar sofort.'
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
				unitPriceCents: 4500,
				vatRate: 19
			})
		],
		notes: 'Vielen Dank für die Zusammenarbeit.'
	},
	{
		number: '2026-48213-001',
		issuer: {
			name: 'Wolkenfabrik UG',
			address: 'Musterstadt',
			vatId: 'DE123',
			email: '',
			iban: 'DE00'
		},
		issuedBy: 'did:key:z6Mkha'
	}
);

describe('invoicePdfBytes', () => {
	it('makes a PDF', async () => {
		const bytes = await invoicePdfBytes(invoice, LABELS);
		expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
		expect(bytes.byteLength).toBeGreaterThan(1000);
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
