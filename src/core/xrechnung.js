/**
 * An issued invoice as an XRechnung: UN/CEFACT CII (D16B), CIUS XRechnung 3.0,
 * EN 16931.
 *
 * It is written from the issued record, as the PDF is, and its figures come
 * from the same `computeTotals`: the XML and the PDF of one invoice cannot add
 * up differently. What it needs beyond the PDF is checked by
 * `xrechnungProblems` before the invoice is issued, and `xrechnungXml` refuses
 * an invoice that would still fail it. KoSIT's validator checks the result in
 * CI (`scripts/kosit.sh`, the fixtures from `scripts/xrechnung-fixtures.js`).
 *
 * A Storno is a credit note (type code 381): its lines come back with the
 * quantities positive, and it names the invoice it cancels (BT-25). It pays
 * nothing in, so its payment means is "not defined" rather than the issuer's
 * account.
 *
 * Element order follows the CII schema, which is a sequence: an element out of
 * order is a schema error, not a style question.
 */

import { VAT_CURRENCY } from './currency.js';
import { dueDay } from './document.js';
import { computeTotals } from './money.js';
import { moneyUnit, upgradeInvoice, vatInEuroCents } from './records.js';
import { postalFromAddress, wantsXRechnung, xrechnungProblems } from './xrechnung-rules.js';

/** BT-24: the specification an XRechnung 3.0 declares. */
export const XRECHNUNG_GUIDELINE =
	'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
/** BT-23: the business process, which PEPPOL-EN16931-R001 requires. */
export const XRECHNUNG_PROCESS = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

/** The exemption reasons (BT-120) of the tax modes that charge no VAT. */
const EXEMPTION = /** @type {Record<string, { reason: string, code?: string }>} */ ({
	E: { reason: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.' },
	AE: {
		reason: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge, § 13b UStG).',
		code: 'VATEX-EU-AE'
	}
});

/**
 * UN/ECE Recommendation 20 codes (BT-130) for the units an invoice is counted
 * in. Units typed by hand that are not here go out as C62, "one" — the unit
 * name stays readable in the PDF.
 */
const UNIT_CODES = /** @type {Record<string, string>} */ ({
	stück: 'H87',
	stk: 'H87',
	'stk.': 'H87',
	piece: 'H87',
	stunde: 'HUR',
	stunden: 'HUR',
	std: 'HUR',
	'std.': 'HUR',
	h: 'HUR',
	hour: 'HUR',
	minute: 'MIN',
	min: 'MIN',
	tag: 'DAY',
	tage: 'DAY',
	day: 'DAY',
	woche: 'WEE',
	week: 'WEE',
	monat: 'MON',
	monate: 'MON',
	month: 'MON',
	jahr: 'ANN',
	year: 'ANN',
	pauschale: 'LS',
	pauschal: 'LS',
	'lump sum': 'LS',
	km: 'KMT',
	kg: 'KGM'
});

/** @param {unknown} unit */
export function unitCode(unit) {
	return (
		UNIT_CODES[
			String(unit ?? '')
				.trim()
				.toLowerCase()
		] ?? 'C62'
	);
}

/** @param {unknown} value */
function escape(value) {
	return String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/**
 * An element with text, or nothing at all when there is no text:
 * PEPPOL-EN16931-R008 rejects empty elements.
 *
 * @param {string} name
 * @param {unknown} value
 * @param {string} [attributes]
 */
function el(name, value, attributes = '') {
	const text = String(value ?? '').trim();
	return text === '' ? '' : `<${name}${attributes}>${escape(text)}</${name}>`;
}

/**
 * An element around children, or nothing when none of them produced anything.
 *
 * @param {string} name
 * @param {string[]} children
 */
function group(name, children) {
	const inner = children.join('');
	return inner === '' ? '' : `<${name}>${inner}</${name}>`;
}

/** @param {string} isoDay */
function date(isoDay) {
	return `<udt:DateTimeString format="102">${String(isoDay).replaceAll('-', '')}</udt:DateTimeString>`;
}

/**
 * An amount in the smallest unit as CII writes it: a dot, every decimal.
 *
 * @param {string | bigint} units
 * @param {number} decimals
 */
function amount(units, decimals) {
	const value = BigInt(units);
	const negative = value < 0n;
	const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');
	const whole = decimals === 0 ? digits : digits.slice(0, -decimals);
	const fraction = decimals === 0 ? '' : `.${digits.slice(-decimals)}`;
	return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** A quantity with up to four decimals, never in exponent notation. @param {number} quantity */
function quantity(quantity) {
	return quantity.toFixed(4).replace(/\.?0+$/, '');
}

/** @param {number} rate */
function percent(rate) {
	return Number.isInteger(rate) ? String(rate) : rate.toFixed(2);
}

/**
 * A postal address (BG-5, BG-8): the lines of the free-text block that are not
 * the post code line, and the post code, city and country kept beside it.
 *
 * @param {{ address?: string, postcode?: string, city?: string, country?: string }} party
 */
function postalAddress(party) {
	// The street lines: the block without its post code line, however that line
	// is written (the check made sure the post code is in the block).
	const postcode = String(party.postcode ?? '').trim();
	const [one, two, three] = postalFromAddress(party.address).lines.filter(
		(line) => !(postcode && line.includes(postcode))
	);
	return group('ram:PostalTradeAddress', [
		el('ram:PostcodeCode', party.postcode),
		el('ram:LineOne', one),
		el('ram:LineTwo', two),
		el('ram:LineThree', three),
		el('ram:CityName', party.city),
		el('ram:CountryID', String(party.country ?? '').toUpperCase())
	]);
}

/**
 * The XRechnung's file name, beside the PDF's.
 *
 * @param {{ number?: string }} invoice
 */
export function xrechnungFileName(invoice) {
	const number = String(invoice?.number ?? 'Entwurf').replace(/[^A-Za-z0-9._-]/g, '-');
	return `Rechnung-${number}.xml`;
}

/**
 * Whether `xrechnungXml` makes an XRechnung of this record: an issued invoice
 * whose customer gets one, with nothing the check refuses. An invoice issued
 * before the app knew XRechnung has none; it stays the PDF it was.
 *
 * @param {any} record
 */
export function hasXRechnung(record) {
	const invoice = upgradeInvoice(record);
	return (
		invoice?.state === 'issued' &&
		Boolean(invoice.number) &&
		wantsXRechnung(invoice) &&
		xrechnungProblems(invoice).length === 0
	);
}

/**
 * The XRechnung of an issued invoice, as a UTF-8 XML string.
 *
 * @param {any} record an issued invoice
 * @returns {string}
 */
export function xrechnungXml(record) {
	const invoice = upgradeInvoice(record);
	if (invoice?.state !== 'issued' || !invoice.number) {
		throw new Error('Only an issued invoice has an XRechnung.');
	}
	const problems = xrechnungProblems(invoice);
	if (problems.length > 0) {
		throw new Error(`This invoice cannot be an XRechnung: ${problems[0].code}`);
	}

	const credit = Boolean(invoice.cancels);
	const { code: currency, decimals } = moneyUnit(invoice);
	const money = (/** @type {string | bigint} */ units) => amount(units, decimals);
	// A credit note states its amounts the way an invoice does; the type code
	// says which way the money goes.
	/** @type {import('./records.js').InvoiceLine[]} */
	const lines = credit
		? invoice.lines.map((/** @type {any} */ line) => ({ ...line, quantity: -line.quantity }))
		: invoice.lines;
	const totals = computeTotals(lines, invoice.taxMode ?? 'standard');
	const taxInEuroCents = vatInEuroCents(invoice, totals);
	const issuer = invoice.issuer;
	const customer = invoice.customer;
	const due = dueDay(invoice.issueDate, invoice.paymentTermsDays ?? 0);

	const lineItems = totals.lines.map((line, index) => {
		const description = [line.subtitle, ...(line.details ?? [])]
			.map((part) => String(part ?? '').trim())
			.filter(Boolean)
			.join('\n');
		return group('ram:IncludedSupplyChainTradeLineItem', [
			group('ram:AssociatedDocumentLineDocument', [el('ram:LineID', index + 1)]),
			group('ram:SpecifiedTradeProduct', [
				el('ram:Name', line.description),
				el('ram:Description', description)
			]),
			group('ram:SpecifiedLineTradeAgreement', [
				group('ram:NetPriceProductTradePrice', [el('ram:ChargeAmount', money(line.unitPrice))])
			]),
			group('ram:SpecifiedLineTradeDelivery', [
				el('ram:BilledQuantity', quantity(line.quantity), ` unitCode="${unitCode(line.unit)}"`)
			]),
			group('ram:SpecifiedLineTradeSettlement', [
				group('ram:ApplicableTradeTax', [
					el('ram:TypeCode', 'VAT'),
					el('ram:CategoryCode', line.vatCategory),
					el('ram:RateApplicablePercent', percent(line.vatRate))
				]),
				group('ram:SpecifiedTradeSettlementLineMonetarySummation', [
					el('ram:LineTotalAmount', money(line.net))
				])
			])
		]);
	});

	const seller = group('ram:SellerTradeParty', [
		el('ram:Name', issuer.name),
		group('ram:SpecifiedLegalOrganization', [el('ram:ID', issuer.register?.number)]),
		group('ram:DefinedTradeContact', [
			el('ram:PersonName', issuer.contactName),
			group('ram:TelephoneUniversalCommunication', [el('ram:CompleteNumber', issuer.phone)]),
			group('ram:EmailURIUniversalCommunication', [el('ram:URIID', issuer.email)])
		]),
		postalAddress(issuer),
		group('ram:URIUniversalCommunication', [el('ram:URIID', issuer.email, ' schemeID="EM"')]),
		group('ram:SpecifiedTaxRegistration', [el('ram:ID', issuer.taxNumber, ' schemeID="FC"')]),
		group('ram:SpecifiedTaxRegistration', [el('ram:ID', issuer.vatId, ' schemeID="VA"')])
	]);

	const buyer = group('ram:BuyerTradeParty', [
		el('ram:ID', customer.number),
		el('ram:Name', customer.name),
		postalAddress(customer),
		group('ram:URIUniversalCommunication', [el('ram:URIID', customer.email, ' schemeID="EM"')]),
		group('ram:SpecifiedTaxRegistration', [el('ram:ID', customer.vatId, ' schemeID="VA"')])
	]);

	const paymentMeans = credit
		? group('ram:SpecifiedTradeSettlementPaymentMeans', [
				el('ram:TypeCode', '1'),
				el('ram:Information', `Erstattung zu Rechnung ${invoice.cancels}`)
			])
		: group('ram:SpecifiedTradeSettlementPaymentMeans', [
				// 58 is a SEPA credit transfer, which carries euros only; 30 any other.
				el('ram:TypeCode', currency === VAT_CURRENCY ? '58' : '30'),
				group('ram:PayeePartyCreditorFinancialAccount', [
					el(
						'ram:IBANID',
						String(issuer.bank?.iban ?? '')
							.replace(/\s+/g, '')
							.toUpperCase()
					),
					el('ram:AccountName', issuer.name)
				]),
				group('ram:PayeeSpecifiedCreditorFinancialInstitution', [
					el(
						'ram:BICID',
						String(issuer.bank?.bic ?? '')
							.replace(/\s+/g, '')
							.toUpperCase()
					)
				])
			]);

	const taxes = totals.vatBreakdown.map((breakdown) =>
		group('ram:ApplicableTradeTax', [
			el('ram:CalculatedAmount', money(breakdown.tax)),
			el('ram:TypeCode', 'VAT'),
			el('ram:ExemptionReason', EXEMPTION[breakdown.category]?.reason),
			el('ram:BasisAmount', money(breakdown.taxable)),
			el('ram:CategoryCode', breakdown.category),
			el('ram:ExemptionReasonCode', EXEMPTION[breakdown.category]?.code),
			el('ram:RateApplicablePercent', percent(breakdown.rate))
		])
	);

	const paymentTerms = group('ram:SpecifiedTradePaymentTerms', [
		el(
			'ram:Description',
			credit
				? `Storno der Rechnung ${invoice.cancels}.`
				: invoice.paymentTermsDays > 0
					? `Zahlbar innerhalb von ${invoice.paymentTermsDays} Tagen ohne Abzug.`
					: 'Zahlbar sofort ohne Abzug.'
		),
		due ? `<ram:DueDateDateTime>${date(due)}</ram:DueDateDateTime>` : ''
	]);

	const summation = group('ram:SpecifiedTradeSettlementHeaderMonetarySummation', [
		el('ram:LineTotalAmount', money(totals.net)),
		el('ram:TaxBasisTotalAmount', money(totals.net)),
		el('ram:TaxTotalAmount', money(totals.tax), ` currencyID="${currency}"`),
		// BT-111 (BR-53): the VAT in the accounting currency, which German VAT is owed in.
		taxInEuroCents === null
			? ''
			: el('ram:TaxTotalAmount', amount(taxInEuroCents, 2), ` currencyID="${VAT_CURRENCY}"`),
		el('ram:GrandTotalAmount', money(totals.gross)),
		el('ram:DuePayableAmount', money(totals.due))
	]);

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<rsm:CrossIndustryInvoice',
		' xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"',
		' xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"',
		' xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"',
		' xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">',
		group('rsm:ExchangedDocumentContext', [
			group('ram:BusinessProcessSpecifiedDocumentContextParameter', [
				el('ram:ID', XRECHNUNG_PROCESS)
			]),
			group('ram:GuidelineSpecifiedDocumentContextParameter', [el('ram:ID', XRECHNUNG_GUIDELINE)])
		]),
		group('rsm:ExchangedDocument', [
			el('ram:ID', invoice.number),
			el('ram:TypeCode', credit ? '381' : '380'),
			`<ram:IssueDateTime>${date(invoice.issueDate)}</ram:IssueDateTime>`,
			// One note at most (PEPPOL-EN16931-R002, unless both sides are German).
			group('ram:IncludedNote', [el('ram:Content', invoice.notes)])
		]),
		group('rsm:SupplyChainTradeTransaction', [
			...lineItems,
			group('ram:ApplicableHeaderTradeAgreement', [
				el('ram:BuyerReference', customer.buyerReference),
				seller,
				buyer
			]),
			group('ram:ApplicableHeaderTradeDelivery', [
				group('ram:ActualDeliverySupplyChainEvent', [
					`<ram:OccurrenceDateTime>${date(invoice.deliveryDate)}</ram:OccurrenceDateTime>`
				])
			]),
			group('ram:ApplicableHeaderTradeSettlement', [
				taxInEuroCents === null ? '' : el('ram:TaxCurrencyCode', VAT_CURRENCY),
				el('ram:InvoiceCurrencyCode', currency),
				paymentMeans,
				...taxes,
				paymentTerms,
				summation,
				credit
					? group('ram:InvoiceReferencedDocument', [el('ram:IssuerAssignedID', invoice.cancels)])
					: ''
			])
		]),
		'</rsm:CrossIndustryInvoice>',
		''
	].join('\n');
}
