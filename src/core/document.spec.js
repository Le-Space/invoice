import { describe, expect, it } from 'vitest';
import { documentModel, dueDay, formatDay } from './document.js';
import { emptyLine, issue } from './records.js';
import { emptyDraft } from './records.js';

const LABELS = {
	title: 'Rechnung',
	titleCancellation: 'Stornorechnung',
	invoiceDate: 'Rechnungsdatum',
	deliveryDate: 'Leistungsdatum',
	cancels: 'Storniert',
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
	paymentOnReceipt: 'Zahlbar sofort.',
	'invoice.note.kleinunternehmer': 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
	'invoice.note.reverseCharge': 'Steuerschuldnerschaft des Leistungsempfängers.'
};

const ISSUER = {
	name: 'Wolkenfabrik UG',
	address: 'Musterstraße 1\n12345 Musterstadt',
	vatId: 'DE123',
	email: 'post@example.org',
	iban: 'DE00 0000'
};

function issued(/** @type {any} */ changes = {}) {
	const draft = {
		...emptyDraft({ issueDate: '2026-09-24' }),
		customer: { name: 'Stromwerk Test AG', address: 'Probehausen', vatId: '' },
		lines: [
			emptyLine({ description: 'Tagessatz', quantity: 2, unit: 'Tage', unitPriceCents: 50_000 })
		],
		paymentTermsDays: 14,
		...changes
	};
	return issue(draft, { number: '2026-48213-001', issuer: ISSUER, issuedBy: 'did:key:z6Mkha' });
}

describe('dates', () => {
	it('writes a German date', () => {
		expect(formatDay('2026-09-24')).toBe('24.09.2026');
		expect(formatDay('2026-09-24', 'en')).toBe('24 Sep 2026');
	});

	it('counts the payment days from the invoice date, across a month end', () => {
		expect(dueDay('2026-09-24', 14)).toBe('2026-10-08');
	});

	it('says nothing rather than something wrong', () => {
		expect(formatDay('')).toBe('');
		expect(dueDay('not a day', 14)).toBe('');
	});
});

describe('documentModel', () => {
	it('splits an address into the lines it was typed as', () => {
		// A stray newline reaches the PDF as a '?', which is how
		// "Kölner Straße 9?50667 Köln" once went out to a customer.
		const model = documentModel(
			issued({
				customer: { name: 'Acme GmbH', address: 'Hauptstraße 1\n34567 Probehausen', vatId: '' }
			}),
			LABELS
		);
		expect(model.recipient).toEqual(['Acme GmbH', 'Hauptstraße 1', '34567 Probehausen']);
		expect(model.issuer.some((line) => line.includes('\n'))).toBe(false);
	});

	it('shows who charges whom, and what for', () => {
		const model = documentModel(issued(), LABELS);
		expect(model.issuer[0]).toBe('Wolkenfabrik UG');
		expect(model.recipient).toEqual(['Stromwerk Test AG', 'Probehausen']);
		expect(model.title).toBe('Rechnung 2026-48213-001');
		expect(model.rows).toEqual([
			['1', 'Tagessatz', '2 Tage', '500,00\u00A0€', '19 %', '1.000,00\u00A0€']
		]);
	});

	it('adds up to the gross total, with the VAT named per rate', () => {
		const model = documentModel(issued(), LABELS);
		expect(model.totals).toEqual([
			['Zwischensumme netto', '1.000,00\u00A0€'],
			['USt 19 %', '190,00\u00A0€'],
			['Gesamtbetrag', '1.190,00\u00A0€']
		]);
	});

	it('names the day the money is due', () => {
		expect(documentModel(issued(), LABELS).payment).toBe('Zahlbar ohne Abzug bis zum 08.10.2026.');
	});

	it('carries the §19 sentence and shows no VAT at all', () => {
		const model = documentModel(issued({ taxMode: 'kleinunternehmer' }), LABELS);
		expect(model.note).toContain('§ 19 UStG');
		expect(model.totals.map(([label]) => label)).toEqual(['Zwischensumme netto', 'Gesamtbetrag']);
		expect(model.rows[0][4]).toBe('—');
	});

	it('calls a Storno a Storno and names what it takes back', () => {
		const model = documentModel({ ...issued(), cancels: '2026-48213-000' }, LABELS);
		expect(model.title).toBe('Stornorechnung 2026-48213-001');
		expect(model.meta).toContainEqual(['Storniert', '2026-48213-000']);
	});

	it('shows the recipient’s VAT id when the tax is theirs to pay', () => {
		const model = documentModel(
			issued({
				taxMode: 'reverse-charge',
				customer: { name: 'Acme BV', address: 'Amsterdam', vatId: 'NL001' }
			}),
			LABELS
		);
		expect(model.recipient).toContain('USt-IdNr: NL001');
		expect(model.note).toContain('Leistungsempfängers');
	});
});
