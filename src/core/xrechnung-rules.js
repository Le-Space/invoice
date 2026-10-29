/**
 * What an invoice needs before it can go out as an XRechnung, checked in the
 * app before it is issued.
 *
 * The reference is the KoSIT validator with its XRechnung configuration, and
 * it runs in CI (`scripts/kosit.sh`): it needs Java, so it cannot run in this
 * app, which works in the browser and sends the books nowhere. What it would
 * reject for missing data is cheap to see here, though, and that is what this
 * module does — the German mandatory set (BR-DE-*), the two electronic
 * addresses XRechnung 3.0 takes over from Peppol (PEPPOL-EN16931-R010/R020),
 * and what this app cannot express in EN 16931 at all (a crypto currency, a
 * negative price). The rule ids are named at each check, so a rejection by
 * KoSIT can be traced back to the field.
 *
 * The address stays the free text the PDF prints. XRechnung wants the post
 * code, the city and the country on their own (BR-DE-3/4/8/9, BR-9/11), so
 * those are kept beside it, and the check makes sure the two agree.
 */

import { currencyOf } from './currency.js';
import { toUnits } from './money.js';

/** The formats an invoice can be sent in, as chosen with its customer. */
export const E_INVOICE_FORMATS = Object.freeze(['pdf', 'xrechnung']);

/**
 * ISO 3166-1 alpha-2, as the EN 16931 code list has it (BR-CL-14), taken from
 * the CEN Schematron that KoSIT runs: with `1A` for Kosovo, `EL` for Greece
 * and `XI` for Northern Ireland.
 */
const COUNTRIES = new Set(
	(
		'1A AD AE AF AG AI AL AM AN AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BL BJ BM BN BO BQ ' +
		'BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ ' +
		'EC EE EG EH EL ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW ' +
		'GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ ' +
		'LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX ' +
		'MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO ' +
		'RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM ' +
		'TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XI YE YT ZA ZM ZW'
	).split(' ')
);

/** @param {unknown} code */
export function isCountryCode(code) {
	return COUNTRIES.has(String(code ?? '').trim());
}

/** The e-mail pattern of the XRechnung Schematron (`XR-EMAIL-REGEX`). */
const EMAIL = /^[^@\s]+@([^@.\s]+\.)+[^@.\s]+$/;

/** @param {unknown} value */
export function isEmail(value) {
	return EMAIL.test(String(value ?? '').trim());
}

/**
 * Country names an address block commonly ends on, so that a block written
 * the way a letter is addressed still yields its post code line.
 */
const COUNTRY_NAMES = /** @type {Record<string, string>} */ ({
	deutschland: 'DE',
	germany: 'DE',
	österreich: 'AT',
	austria: 'AT',
	schweiz: 'CH',
	switzerland: 'CH',
	niederlande: 'NL',
	netherlands: 'NL',
	frankreich: 'FR',
	france: 'FR',
	belgien: 'BE',
	belgium: 'BE',
	luxemburg: 'LU',
	luxembourg: 'LU'
});

/**
 * The post code, the city and the remaining lines of an address block, as far
 * as they can be read from it: the last line of the form "12345 Musterstadt"
 * (four or five digits, as in Germany, Austria and Switzerland), optionally
 * followed by a country name. Empty strings where nothing fits — the person
 * fills those in, nothing is guessed beyond this.
 *
 * @param {unknown} text
 * @returns {{ postcode: string, city: string, country: string, lines: string[] }}
 */
export function postalFromAddress(text) {
	const lines = String(text ?? '')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	let country = '';
	let end = lines.length;
	const named = COUNTRY_NAMES[String(lines[end - 1] ?? '').toLowerCase()];
	if (named) {
		country = named;
		end -= 1;
	}
	const match = /^(?:[A-Z]{1,2}-)?(\d{4,5})\s+(.+)$/.exec(lines[end - 1] ?? '');
	if (!match) return { postcode: '', city: '', country, lines: lines.slice(0, end) };
	return { postcode: match[1], city: match[2].trim(), country, lines: lines.slice(0, end - 1) };
}

/**
 * Whether the free-text address names this post code and city, so the PDF and
 * the XRechnung of one invoice cannot say two different places.
 *
 * @param {unknown} address
 * @param {unknown} postcode
 * @param {unknown} city
 */
export function addressAgrees(address, postcode, city) {
	const squash = (/** @type {unknown} */ value) =>
		String(value ?? '')
			.replace(/\s+/g, ' ')
			.trim()
			.toLowerCase();
	const block = squash(address);
	return block.includes(squash(postcode)) && block.includes(squash(city));
}

/**
 * Whether this invoice is to go out as an XRechnung: the format is chosen with
 * the customer, and a Storno keeps the customer of what it cancels.
 *
 * @param {{ customer?: { eInvoice?: string } } | null | undefined} invoice
 */
export function wantsXRechnung(invoice) {
	return invoice?.customer?.eInvoice === 'xrechnung';
}

/**
 * What an XRechnung of this invoice would be rejected for, as problem codes
 * under `invoice.problem.xr.*`. A draft is checked against the issuer in the
 * settings, an issued invoice against the issuer frozen with it.
 *
 * @param {any} invoice a draft or an issued invoice
 * @param {{ issuer?: any }} [context]
 * @returns {{ code: string, field: string, line?: number }[]}
 */
export function xrechnungProblems(invoice, { issuer = invoice?.issuer } = {}) {
	/** @type {{ code: string, field: string, line?: number }[]} */
	const problems = [];
	const text = (/** @type {unknown} */ value) => (typeof value === 'string' ? value.trim() : '');
	const add = (/** @type {string} */ code, /** @type {string} */ field) =>
		problems.push({ code: `invoice.problem.xr.${code}`, field });
	const seller = issuer ?? {};
	const buyer = invoice?.customer ?? {};

	// BR-CL-04: the invoice currency is an ISO 4217 code. BTC, ETH, USDC and the
	// other assets have none, so an invoice in them has no XRechnung.
	if (currencyOf(invoice?.currency ?? 'EUR')?.kind !== 'fiat') add('currency', 'currency');

	// The seller (BG-4), its contact (BG-6) and its address (BG-5).
	if (!text(seller.contactName)) add('issuerContact', 'issuer.contactName'); // BR-DE-5
	// BR-DE-6; BR-DE-27 wants at least three digits in it.
	if ((text(seller.phone).match(/\d/g) ?? []).length < 3) add('issuerPhone', 'issuer.phone');
	// BR-DE-7 (BT-43) and PEPPOL-EN16931-R020 (BT-34): the same address serves both.
	if (!isEmail(seller.email)) add('issuerEmail', 'issuer.email');
	if (!text(seller.postcode)) add('issuerPostcode', 'issuer.postcode'); // BR-DE-4
	if (!text(seller.city)) add('issuerCity', 'issuer.city'); // BR-DE-3
	if (!isCountryCode(seller.country)) add('issuerCountry', 'issuer.country'); // BR-9, BR-CL-14
	if (
		text(seller.postcode) &&
		text(seller.city) &&
		!addressAgrees(seller.address, seller.postcode, seller.city)
	) {
		add('issuerAddressMismatch', 'issuer.address');
	}
	// BR-DE-16: a VAT id or a tax number, whatever the tax mode.
	if (!text(seller.vatId) && !text(seller.taxNumber)) add('issuerTaxId', 'issuer.vatId');
	// BR-AE-02: reverse charge names the seller's VAT id, a tax number is not enough.
	if (invoice?.taxMode === 'reverse-charge' && !text(seller.vatId)) {
		add('issuerVatId', 'issuer.vatId');
	}
	// BR-DE-1 with BR-DE-23: the payment instructions carry the IBAN. A Storno
	// pays nothing in, so it does not need one.
	if (!invoice?.cancels && !text(seller.bank?.iban)) add('iban', 'issuer.bank.iban');

	// The buyer (BG-7) and its address (BG-8).
	if (!text(buyer.buyerReference)) add('buyerReference', 'customer.buyerReference'); // BR-DE-15
	if (!isEmail(buyer.email)) add('customerEmail', 'customer.email'); // PEPPOL-EN16931-R010
	if (!text(buyer.postcode)) add('customerPostcode', 'customer.postcode'); // BR-DE-9
	if (!text(buyer.city)) add('customerCity', 'customer.city'); // BR-DE-8
	if (!isCountryCode(buyer.country)) add('customerCountry', 'customer.country'); // BR-11
	if (
		text(buyer.postcode) &&
		text(buyer.city) &&
		!addressAgrees(buyer.address, buyer.postcode, buyer.city)
	) {
		add('customerAddressMismatch', 'customer.address');
	}

	// BR-27: an item's net price is never negative; a discount is a line with a
	// negative quantity instead.
	(Array.isArray(invoice?.lines) ? invoice.lines : []).forEach(
		(/** @type {any} */ line, /** @type {number} */ index) => {
			const price = toUnits(line?.unitPrice);
			if (price !== null && price < 0n) {
				problems.push({
					code: 'invoice.problem.xr.negativePrice',
					field: 'unitPrice',
					line: index
				});
			}
		}
	);

	return problems;
}
