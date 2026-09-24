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

import { giroCodePayload, remittanceFor } from './girocode.js';
import { formatAmount } from './money.js';
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

/**
 * An IBAN in groups of four, the way it is printed and read aloud.
 *
 * @param {unknown} value
 */
export function formatIban(value) {
	const account = String(value ?? '')
		.replace(/\s+/g, '')
		.toUpperCase();
	return account.replace(/(.{4})/g, '$1 ').trim();
}

/** @param {number} quantity */
function formatQuantity(quantity) {
	return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 }).format(quantity);
}

/**
 * A label and its value, as the header and footer print them: "IBAN: DE…".
 *
 * @param {string} label
 * @param {unknown} value
 */
function pair(label, value) {
	const text = String(value ?? '').trim();
	return text === '' ? null : { label, value: text };
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
	const bank = issuer.bank ?? {};
	const register = issuer.register ?? {};
	const crypto = issuer.crypto ?? {};
	const due = dueDay(invoice.issueDate, invoice.paymentTermsDays);
	const address = asLines([issuer.address]);

	const registerEntry = [register.court, register.number].filter(Boolean).join(', ');
	const reference = remittanceFor(invoice.number, labels);

	return {
		/** A PNG data URL, drawn top left, or '' when nobody uploaded one. */
		logo: String(issuer.logo ?? ''),
		/**
		 * The block top right: who is charging, and how to reach them.
		 *
		 * @type {{ label: string, value: string, strong?: boolean }[]}
		 */
		header: /** @type {{ label: string, value: string, strong?: boolean }[]} */ (
			[
				{ label: '', value: String(issuer.name ?? ''), strong: true },
				...address.map((line) => ({ label: '', value: line })),
				pair(labels.register, registerEntry),
				pair(labels.vatId, issuer.vatId),
				pair(labels.taxNumber, issuer.taxNumber),
				pair(labels.email, issuer.email),
				pair(labels.phone, issuer.phone),
				pair(labels.web, issuer.web)
			].filter(Boolean)
		),
		/** The line above the address field, as the post expects it. */
		sender: [issuer.name, ...address].filter(Boolean).join(' · '),
		/** Kept for the sender line and for anything that wants the raw block. */
		issuer: asLines([issuer.name, issuer.address, issuer.email]),
		/** The address field, as it goes into a window envelope. */
		recipient: asLines([
			customer.name,
			customer.address,
			customer.vatId && `${labels.vatId} ${customer.vatId}`
		]),
		title: invoice.cancels ? labels.titleCancellation : labels.title,
		number: String(invoice.number ?? ''),
		/** Label/value pairs beside the title. */
		meta: /** @type {[string, string][]} */ ([
			[labels.invoiceDate, formatDay(invoice.issueDate, locale)],
			[labels.deliveryDate, formatDay(invoice.deliveryDate, locale)],
			...(due ? [[labels.dueDate, formatDay(due, locale)]] : []),
			...(invoice.cancels ? [[labels.cancels, invoice.cancels]] : [])
		]),
		columns: [
			labels.position,
			labels.description,
			labels.quantity,
			labels.unit,
			labels.unitPrice,
			labels.vat,
			labels.lineNet
		],
		rows: totals.lines.map((line, index) => [
			String(index + 1),
			String(line.description ?? ''),
			formatQuantity(line.quantity),
			String(line.unit ?? ''),
			formatAmount(line.unitPriceCents),
			invoice.taxMode === 'standard' ? `${line.vatRate} %` : '—',
			formatAmount(line.netCents)
		]),
		/** The summing block, ending on the amount somebody has to pay. */
		totals: [
			{ label: labels.subtotal, value: formatAmount(totals.netTotalCents) },
			...(invoice.taxMode === 'standard'
				? totals.vatBreakdown.map((group) => ({
						label: labels.vatOf
							.replace('{rate}', String(group.rate))
							.replace('{base}', formatAmount(group.taxableCents)),
						value: formatAmount(group.taxCents)
					}))
				: []),
			{ label: labels.totalCurrency, value: formatAmount(totals.grossTotalCents), strong: true },
			{ label: labels.amountDue, value: formatAmount(totals.dueCents), due: true }
		],
		/** §19 UStG or §13b UStG, whichever the tax mode requires. */
		note: invoice.noteCode ? labels[invoice.noteCode] : '',
		netNote: labels.netNote ?? '',
		payment: due
			? labels.paymentTerms
					.replace('{amount}', `${formatAmount(totals.dueCents)} EUR`)
					.replace('{date}', formatDay(due, locale))
					.replace('{number}', String(invoice.number ?? ''))
			: labels.paymentOnReceipt,
		/**
		 * The transfer, as a banking app can read it. Absent where there is no
		 * IBAN to pay into, or nothing to pay — a Storno owes money the other
		 * way, and no credit transfer can carry that.
		 */
		giro: (() => {
			const payload = giroCodePayload({
				iban: bank.iban,
				bic: bank.bic,
				name: issuer.name,
				amountCents: totals.dueCents,
				reference
			});
			return payload ? { payload, caption: labels.giroCaption, hint: labels.giroHint } : null;
		})(),
		/**
		 * The three lines every page carries at its foot; a line nobody filled
		 * in is left out rather than printed as a bare label.
		 *
		 * @type {{ label: string, value: string }[][]}
		 */
		footer: /** @type {{ label: string, value: string }[][]} */ (
			[
				[
					pair('', issuer.name),
					pair('', address.join(' · ')),
					pair(labels.email, issuer.email),
					pair(labels.phone, issuer.phone)
				],
				[
					pair(labels.managingDirector, register.managingDirector),
					pair(labels.registerCourt, registerEntry),
					pair(labels.vatId, issuer.vatId),
					pair(labels.taxNumber, issuer.taxNumber)
				],
				[
					pair(labels.bank, bank.name),
					pair(labels.iban, formatIban(bank.iban)),
					pair(labels.bic, bank.bic),
					pair(labels.accountHolder, issuer.name && bank.iban ? issuer.name : '')
				],
				[pair(labels.btc, crypto.btc), pair(labels.eth, crypto.eth)]
			]
				.map((line) => line.filter(Boolean))
				.filter((line) => line.length > 0)
		),
		freeText: String(invoice.notes ?? '').trim()
	};
}
