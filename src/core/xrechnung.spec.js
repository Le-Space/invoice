import { describe, expect, it } from 'vitest';
import { fixtures } from '../../scripts/xrechnung-fixtures.js';
import { computeTotals } from './money.js';
import { emptyDraft } from './records.js';
import { hasXRechnung, unitCode, xrechnungFileName, xrechnungXml } from './xrechnung.js';

const byName = Object.fromEntries(fixtures().map(({ name, invoice }) => [name, invoice]));

/** The text of every element with this name, in order. @param {string} xml @param {string} name */
function texts(xml, name) {
	return [...xml.matchAll(new RegExp(`<${name}(?: [^>]*)?>([^<]*)</${name}>`, 'g'))].map(
		(m) => m[1]
	);
}

/** An amount as CII writes it, back in the smallest unit. @param {string} text */
const units = (text) => BigInt(text.replace('.', ''));

describe('an XRechnung', () => {
	it('reads back with the totals of the model, in every fixture', () => {
		for (const { name, invoice } of fixtures()) {
			const xml = xrechnungXml(invoice);
			// A Storno is a credit note: the same figures, stated the way an invoice states them.
			const sign = invoice.cancels ? -1n : 1n;
			const model = computeTotals(invoice.lines, invoice.taxMode);
			const [taxInCurrency] = texts(xml, 'ram:TaxTotalAmount');
			expect(
				{
					net: units(texts(xml, 'ram:LineTotalAmount').at(-1) ?? ''),
					basis: units(texts(xml, 'ram:TaxBasisTotalAmount')[0]),
					tax: units(taxInCurrency),
					gross: units(texts(xml, 'ram:GrandTotalAmount')[0]),
					due: units(texts(xml, 'ram:DuePayableAmount')[0])
				},
				name
			).toEqual({
				net: sign * BigInt(model.net),
				basis: sign * BigInt(model.net),
				tax: sign * BigInt(model.tax),
				gross: sign * BigInt(model.gross),
				due: sign * BigInt(model.due)
			});
			// And the lines add up to that net.
			const lines = texts(xml, 'ram:LineTotalAmount').slice(0, -1).map(units);
			expect(
				lines.reduce((a, b) => a + b, 0n),
				name
			).toBe(sign * BigInt(model.net));
		}
	});

	it('has no empty element (PEPPOL-EN16931-R008)', () => {
		for (const { name, invoice } of fixtures()) {
			const xml = xrechnungXml(invoice);
			expect(xml, name).not.toMatch(/<[\w:]+(?: [^>]*)?\/>/);
			expect(xml, name).not.toMatch(/<([\w:]+)(?: [^>]*)?>\s*<\/\1>/);
		}
	});

	it('escapes what was typed', () => {
		const xml = xrechnungXml(byName['01-standard-19']);
		expect(texts(xml, 'ram:Content')).toEqual([
			'Leistungszeitraum Oktober &amp; November &lt;Projekt Wolke&gt;'
		]);
	});

	it('names the buyer reference, both electronic addresses and the contact', () => {
		const xml = xrechnungXml(byName['07-public-body-leitweg-id']);
		expect(texts(xml, 'ram:BuyerReference')).toEqual(['04011000-12345-03']);
		expect(xml).toContain('<ram:URIID schemeID="EM">rechnung@example.com</ram:URIID>');
		expect(xml).toContain('<ram:URIID schemeID="EM">erechnung@example.org</ram:URIID>');
		expect(texts(xml, 'ram:PersonName')).toEqual(['Erika Mustermann']);
		expect(texts(xml, 'ram:PostcodeCode')).toEqual(['12345', '54321']);
		expect(texts(xml, 'ram:LineOne')).toEqual(['Musterstraße 1', 'Rathausplatz 1']);
	});

	it('is a SEPA transfer to the IBAN in euros, and states USD invoices’ VAT in euros', () => {
		const euro = xrechnungXml(byName['01-standard-19']);
		expect(texts(euro, 'ram:TypeCode')).toContain('58');
		expect(texts(euro, 'ram:IBANID')).toEqual(['DE79000000001234567890']);
		expect(euro).not.toContain('TaxCurrencyCode');

		const usd = xrechnungXml(byName['08-usd-vat-in-euro']);
		expect(texts(usd, 'ram:InvoiceCurrencyCode')).toEqual(['USD']);
		expect(texts(usd, 'ram:TaxCurrencyCode')).toEqual(['EUR']);
		// 5 × 199.00 USD = 995.00, 19 % = 189.05 USD, at 0.9132 € = 172.64 €
		expect(usd).toContain('<ram:TaxTotalAmount currencyID="USD">189.05</ram:TaxTotalAmount>');
		expect(usd).toContain('<ram:TaxTotalAmount currencyID="EUR">172.64</ram:TaxTotalAmount>');
	});

	it('makes a Storno a credit note naming the invoice it cancels', () => {
		const xml = xrechnungXml(byName['06-storno']);
		expect(texts(xml, 'ram:TypeCode')[0]).toBe('381');
		expect(texts(xml, 'ram:IssuerAssignedID')).toEqual(['2026-00000-001']);
		expect(texts(xml, 'ram:BilledQuantity')).toEqual(['6.5', '1']);
		expect(xml).not.toContain('IBANID');
	});

	it('gives the exemption reason for reverse charge and § 19 UStG', () => {
		expect(texts(xrechnungXml(byName['04-reverse-charge']), 'ram:ExemptionReasonCode')).toEqual([
			'VATEX-EU-AE'
		]);
		expect(texts(xrechnungXml(byName['05-kleinunternehmer']), 'ram:ExemptionReason')).toEqual([
			'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.'
		]);
	});

	it('counts in UN/ECE Recommendation 20 units', () => {
		expect(['Stück', 'Stunde', 'Tag', 'Monat', 'Pauschale', 'km'].map(unitCode)).toEqual([
			'H87',
			'HUR',
			'DAY',
			'MON',
			'LS',
			'KMT'
		]);
		expect(unitCode('Lizenz')).toBe('C62');
	});

	it('exists only for an issued invoice that has what it needs', () => {
		expect(() => xrechnungXml(emptyDraft())).toThrow(/issued/);
		const incomplete = {
			...byName['01-standard-19'],
			customer: { ...byName['01-standard-19'].customer, buyerReference: '' }
		};
		expect(() => xrechnungXml(incomplete)).toThrow(/buyerReference/);
	});

	it('is said to exist exactly where it can be made', () => {
		for (const { name, invoice } of fixtures()) expect(hasXRechnung(invoice), name).toBe(true);
		const standard = byName['01-standard-19'];
		expect(hasXRechnung(emptyDraft())).toBe(false);
		// A customer who gets a PDF, or an invoice issued before the app knew XRechnung.
		expect(hasXRechnung({ ...standard, customer: { ...standard.customer, eInvoice: 'pdf' } })).toBe(
			false
		);
		const before = { ...standard.customer };
		delete before.eInvoice;
		expect(hasXRechnung({ ...standard, customer: before })).toBe(false);
		expect(
			hasXRechnung({ ...standard, customer: { ...standard.customer, buyerReference: '' } })
		).toBe(false);
	});

	it('is named after its invoice, as the PDF is', () => {
		expect(xrechnungFileName({ number: '2026-00000-001' })).toBe('Rechnung-2026-00000-001.xml');
	});
});
