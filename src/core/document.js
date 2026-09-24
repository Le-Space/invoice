/**
 * The invoice as a document: what is printed, in the order it is printed.
 *
 * Kept apart from the drawing so the part that decides *what* an invoice says
 * can be read and tested without a PDF library — and so a second renderer (the
 * screen, a future XRechnung export) works from the same model rather than
 * from a second reading of the record.
 *
 * The labels come from the caller, so the document speaks the language the
 * reader was using. Everything else comes from the issued invoice, which
 * carries its own copy of the addresses and totals.
 */

import { formatEuro } from './money.js';
import { invoiceTotals } from './records.js';

/** @typedef {Record<string, string>} Labels */

/** Month names for the English form; `Intl` spells medium dates differently
 * from one engine and ICU version to the next, and a date on an invoice should
 * not depend on which browser exported it. */
const EN_MONTHS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];

/** @param {string} isoDay */
export function formatDay(isoDay, locale = 'de-DE') {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDay ?? ''))) return '';
	const [year, month, day] = isoDay.split('-');
	// `08.10.2026` reads as August to an English reader, so the English form
	// names the month instead of numbering it.
	return locale.startsWith('de')
		? `${day}.${month}.${year}`
		: `${day} ${EN_MONTHS[Number(month) - 1]} ${year}`;
}

/**
 * The day payment is due: the invoice date plus the agreed days.
 *
 * @param {string} isoDay
 * @param {number} days
 */
export function dueDay(isoDay, days) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDay ?? ''))) return '';
	const date = new Date(`${isoDay}T12:00:00`);
	date.setDate(date.getDate() + (Number.isFinite(days) ? days : 0));
	return date.toISOString().slice(0, 10);
}

/**
 * The printable lines of an address block.
 *
 * An address is typed into a textarea, so it arrives with newlines in it. A
 * renderer draws one string per line and has no reason to look inside them, so
 * the splitting belongs here — a newline that travels on into the drawing is
 * printed as a stray character, which is how `Kölner Straße 9?50667 Köln`
 * reached a customer's invoice once.
 *
 * @param {unknown[]} parts
 * @returns {string[]}
 */
function asLines(parts) {
	return parts
		.filter(Boolean)
		.flatMap((part) => String(part).split(/\r?\n/))
		.map((line) => line.trim())
		.filter((line) => line !== '');
}

/** @param {number} quantity */
function formatQuantity(quantity) {
	return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 }).format(quantity);
}

/**
 * Everything the printed invoice shows, already formatted.
 *
 * @param {any} invoice an issued invoice
 * @param {Labels} labels
 * @param {{ locale?: string }} [options]
 */
export function documentModel(invoice, labels, { locale = 'de-DE' } = {}) {
	const totals = invoiceTotals(invoice);
	const issuer = invoice.issuer ?? {};
	const customer = invoice.customer ?? {};
	const due = dueDay(invoice.issueDate, invoice.paymentTermsDays);

	return {
		/** Top right, above the address field. */
		issuer: asLines([
			issuer.name,
			issuer.address,
			issuer.email,
			issuer.vatId && `${labels.vatId}: ${issuer.vatId}`
		]),
		/** The address field, as it goes into a window envelope. */
		recipient: asLines([
			customer.name,
			customer.address,
			customer.vatId && `${labels.vatId}: ${customer.vatId}`
		]),
		title: `${invoice.cancels ? labels.titleCancellation : labels.title} ${invoice.number}`,
		/** Label/value pairs beside the title. */
		meta: /** @type {[string, string][]} */ ([
			[labels.invoiceDate, formatDay(invoice.issueDate, locale)],
			[labels.deliveryDate, formatDay(invoice.deliveryDate, locale)],
			...(invoice.cancels ? [[labels.cancels, invoice.cancels]] : [])
		]),
		columns: [
			labels.position,
			labels.description,
			labels.quantity,
			labels.unitPrice,
			labels.vat,
			labels.lineNet
		],
		rows: totals.lines.map((line, index) => [
			String(index + 1),
			String(line.description ?? ''),
			`${formatQuantity(line.quantity)} ${line.unit ?? ''}`.trim(),
			formatEuro(line.unitPriceCents),
			invoice.taxMode === 'standard' ? `${line.vatRate} %` : '—',
			formatEuro(line.netCents)
		]),
		totals: [
			[labels.netTotal, formatEuro(totals.netTotalCents)],
			...totals.vatBreakdown
				.filter(() => invoice.taxMode === 'standard')
				.map((group) => [`${labels.vat} ${group.rate} %`, formatEuro(group.taxCents)]),
			[labels.grossTotal, formatEuro(totals.grossTotalCents)]
		],
		/** §19 UStG or §13b UStG, whichever the tax mode requires. */
		note: invoice.noteCode ? labels[invoice.noteCode] : '',
		payment: due
			? labels.paymentTerms.replace('{date}', formatDay(due, locale))
			: labels.paymentOnReceipt,
		iban: issuer.iban ? `${labels.iban}: ${issuer.iban}` : '',
		freeText: String(invoice.notes ?? '').trim()
	};
}
