import { describe, expect, it } from 'vitest';
import { FIXTURE_ISSUER, fixtures } from '../../scripts/xrechnung-fixtures.js';
import { draftProblems, emptyDraft, emptyLine } from './records.js';
import {
	addressAgrees,
	isCountryCode,
	isEmail,
	postalFromAddress,
	wantsXRechnung,
	xrechnungProblems
} from './xrechnung-rules.js';

const codes = (/** @type {{ code: string }[]} */ problems) => problems.map((p) => p.code);

/** A draft that would make a valid XRechnung, so each test breaks one thing. */
function xrDraft(/** @type {Record<string, any>} */ changes = {}) {
	const { customer, ...rest } = changes;
	return {
		...emptyDraft({ issueDate: '2026-10-20' }),
		customer: {
			name: 'Beispiel Kunde GmbH',
			address: 'Kundenweg 7\n54321 Beispielstadt',
			postcode: '54321',
			city: 'Beispielstadt',
			country: 'DE',
			vatId: '',
			email: 'buchhaltung@example.org',
			buyerReference: 'Bestellung 4711',
			eInvoice: 'xrechnung',
			...customer
		},
		lines: [emptyLine({ description: 'Beratung', quantity: 2, unit: 'Stunde', unitPrice: '9500' })],
		...rest
	};
}

describe('reading an address block', () => {
	it('finds the post code line, and leaves the street lines', () => {
		expect(postalFromAddress('Musterstraße 1\n12345 Musterstadt')).toEqual({
			postcode: '12345',
			city: 'Musterstadt',
			country: '',
			lines: ['Musterstraße 1']
		});
	});

	it('reads past a country name, and takes four-digit post codes', () => {
		expect(postalFromAddress('Probegasse 3\n1010 Wien\nÖsterreich')).toEqual({
			postcode: '1010',
			city: 'Wien',
			country: 'AT',
			lines: ['Probegasse 3']
		});
	});

	it('guesses nothing where no line fits', () => {
		expect(postalFromAddress('10 Downing Street\nLondon SW1A 2AA')).toMatchObject({
			postcode: '',
			city: ''
		});
	});

	it('says whether the block names the post code and city', () => {
		expect(addressAgrees('Kundenweg 7\n54321  Beispielstadt', '54321', 'beispielstadt')).toBe(true);
		expect(addressAgrees('Kundenweg 7\n54321 Beispielstadt', '54322', 'Beispielstadt')).toBe(false);
	});

	it('knows the EN 16931 country codes and the XRechnung e-mail pattern', () => {
		expect(['DE', 'AT', 'EL', 'XI', '1A'].every(isCountryCode)).toBe(true);
		expect(['de', 'D', 'XX', ''].some(isCountryCode)).toBe(false);
		expect(isEmail('rechnung@example.com')).toBe(true);
		expect(isEmail('rechnung@example')).toBe(false);
	});
});

describe('what an XRechnung needs', () => {
	it('is all there in every fixture KoSIT checks', () => {
		for (const { name, invoice } of fixtures()) {
			expect(codes(xrechnungProblems(invoice)), name).toEqual([]);
		}
	});

	it('is the format the customer gets', () => {
		expect(wantsXRechnung(xrDraft())).toBe(true);
		expect(wantsXRechnung(emptyDraft())).toBe(false);
	});

	it('names each missing field of the issuer', () => {
		const issuer = {
			...FIXTURE_ISSUER,
			contactName: '',
			phone: '12',
			email: 'x',
			postcode: '',
			city: '',
			country: 'Deutschland'
		};
		expect(codes(xrechnungProblems(xrDraft(), { issuer }))).toEqual([
			'invoice.problem.xr.issuerContact',
			'invoice.problem.xr.issuerPhone',
			'invoice.problem.xr.issuerEmail',
			'invoice.problem.xr.issuerPostcode',
			'invoice.problem.xr.issuerCity',
			'invoice.problem.xr.issuerCountry'
		]);
	});

	it('names each missing field of the customer, the buyer reference first (BR-DE-15)', () => {
		const draft = xrDraft({
			customer: { buyerReference: ' ', email: '', postcode: '', city: '', country: '' }
		});
		expect(codes(xrechnungProblems(draft, { issuer: FIXTURE_ISSUER }))).toEqual([
			'invoice.problem.xr.buyerReference',
			'invoice.problem.xr.customerEmail',
			'invoice.problem.xr.customerPostcode',
			'invoice.problem.xr.customerCity',
			'invoice.problem.xr.customerCountry'
		]);
	});

	it('refuses a post code and city that the printed address does not name', () => {
		const draft = xrDraft({ customer: { postcode: '99999' } });
		expect(codes(xrechnungProblems(draft, { issuer: FIXTURE_ISSUER }))).toEqual([
			'invoice.problem.xr.customerAddressMismatch'
		]);
		const issuer = { ...FIXTURE_ISSUER, city: 'Anderswo' };
		expect(codes(xrechnungProblems(xrDraft(), { issuer }))).toEqual([
			'invoice.problem.xr.issuerAddressMismatch'
		]);
	});

	it('wants a VAT id or tax number, and the VAT id for reverse charge', () => {
		const none = { ...FIXTURE_ISSUER, vatId: '', taxNumber: '' };
		expect(codes(xrechnungProblems(xrDraft(), { issuer: none }))).toEqual([
			'invoice.problem.xr.issuerTaxId'
		]);
		const taxNumberOnly = { ...FIXTURE_ISSUER, vatId: '' };
		expect(codes(xrechnungProblems(xrDraft(), { issuer: taxNumberOnly }))).toEqual([]);
		const reverse = xrDraft({ taxMode: 'reverse-charge', customer: { vatId: 'ATU12345678' } });
		expect(codes(xrechnungProblems(reverse, { issuer: taxNumberOnly }))).toEqual([
			'invoice.problem.xr.issuerVatId'
		]);
	});

	it('wants the IBAN on an invoice, not on a Storno', () => {
		const issuer = { ...FIXTURE_ISSUER, bank: { name: '', iban: '', bic: '' } };
		expect(codes(xrechnungProblems(xrDraft(), { issuer }))).toEqual(['invoice.problem.xr.iban']);
		expect(codes(xrechnungProblems(xrDraft({ cancels: '2026-00000-001' }), { issuer }))).toEqual(
			[]
		);
	});

	it('has no XRechnung in crypto, and no negative price', () => {
		expect(
			codes(xrechnungProblems(xrDraft({ currency: 'BTC' }), { issuer: FIXTURE_ISSUER }))
		).toEqual(['invoice.problem.xr.currency']);
		const discount = xrDraft({
			lines: [emptyLine({ description: 'Nachlass', quantity: 1, unitPrice: '-500' })]
		});
		expect(xrechnungProblems(discount, { issuer: FIXTURE_ISSUER })).toEqual([
			{ code: 'invoice.problem.xr.negativePrice', field: 'unitPrice', line: 0 }
		]);
	});

	it('stands in the way of issuing only when the customer gets an XRechnung', () => {
		const incomplete = xrDraft({ customer: { buyerReference: '' } });
		expect(codes(draftProblems(incomplete, { issuer: FIXTURE_ISSUER }))).toEqual([
			'invoice.problem.xr.buyerReference'
		]);
		const asPdf = xrDraft({ customer: { buyerReference: '', eInvoice: 'pdf' } });
		expect(draftProblems(asPdf, { issuer: FIXTURE_ISSUER })).toEqual([]);
	});
});
