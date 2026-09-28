/**
 * What an issued invoice was paid, as another app — Belege, which holds the
 * bank statements — reported it (Le-Space/ucep-spec, extensions/invoice.md,
 * `record-payment`).
 *
 * The payments live next to the invoice, never in it: an issued invoice is not
 * rewritten, and a payment changes nothing it says. Each payment is named by
 * the reporting app's own reference (`system` + `id`), so reporting the same
 * payment again replaces it and a payment the app unlinked goes away.
 *
 * Amounts are integers of the invoice's smallest unit in strings, as on the
 * invoice (`money.js`); only what goes over the wire is a decimal string.
 */

import { dueDay } from './document.js';

/**
 * @typedef {{ system: string, id: string }} PaymentReference
 * @typedef {{
 *   paidOn: string,
 *   units: string,
 *   reference: PaymentReference,
 *   recordedAt?: string,
 *   recordedBy?: { label?: string, did?: string }
 * }} Payment
 * @typedef {'open' | 'partially-paid' | 'paid' | 'overpaid'} PaymentState
 */

const DECIMAL = /^\d+(\.\d+)?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "119.00" in the smallest unit of `decimals` ("11900"), or null when it is
 * not a plain non-negative decimal string or has more decimals than that.
 *
 * @param {unknown} value
 * @param {number} decimals
 * @returns {string | null}
 */
export function decimalToUnits(value, decimals) {
	if (typeof value !== 'string' || !DECIMAL.test(value)) return null;
	const [whole, fraction = ''] = value.split('.');
	if (fraction.length > decimals) return null;
	return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`).toString();
}

/**
 * "11900" with two decimals as "119.00": a decimal string with every decimal
 * of the currency, a point and no grouping.
 *
 * @param {string | bigint} units
 * @param {number} decimals
 */
export function unitsToDecimal(units, decimals) {
	const value = BigInt(units);
	const negative = value < 0n;
	const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');
	const whole = digits.slice(0, digits.length - decimals);
	const fraction = decimals > 0 ? `.${digits.slice(digits.length - decimals)}` : '';
	return `${negative ? '-' : ''}${whole}${fraction}`;
}

/**
 * Whether `day` is a calendar day written as YYYY-MM-DD.
 *
 * @param {unknown} day
 */
export function isDay(day) {
	if (typeof day !== 'string' || !DAY.test(day)) return false;
	const date = new Date(`${day}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

/** @param {PaymentReference} a @param {PaymentReference} b */
function sameReference(a, b) {
	return a?.system === b?.system && a?.id === b?.id;
}

/**
 * The payments after one was reported: a new reference is added, a known one
 * replaced, and one reported with `paidOn: null` removed. Sorted by the day
 * paid, so the list reads the same however it came about.
 *
 * @param {Payment[] | undefined} payments
 * @param {{ reference: PaymentReference, paidOn: string | null } & Partial<Payment>} report
 * @returns {Payment[]}
 */
export function applyPayment(payments, report) {
	const others = (payments ?? []).filter((p) => !sameReference(p.reference, report.reference));
	if (report.paidOn === null) return others;
	/** @type {Payment} */
	const payment = {
		paidOn: report.paidOn,
		units: String(report.units),
		reference: { system: report.reference.system, id: report.reference.id },
		...(report.recordedAt ? { recordedAt: report.recordedAt } : {}),
		...(report.recordedBy ? { recordedBy: report.recordedBy } : {})
	};
	return [...others, payment].sort((a, b) =>
		a.paidOn === b.paidOn ? 0 : a.paidOn < b.paidOn ? -1 : 1
	);
}

/**
 * The sum of the payments, in the smallest unit.
 *
 * @param {Payment[] | undefined} payments
 */
export function paidUnits(payments) {
	return (payments ?? []).reduce((sum, p) => sum + BigInt(p.units), 0n);
}

/**
 * @param {string | bigint} total what the customer owes, smallest unit
 * @param {string | bigint} paid
 * @returns {PaymentState}
 */
export function paymentState(total, paid) {
	const owed = BigInt(total);
	const got = BigInt(paid);
	if (got === 0n) return 'open';
	if (got < owed) return 'partially-paid';
	return got === owed ? 'paid' : 'overpaid';
}

/**
 * The day an issued invoice is due, or '' when it cannot be said.
 *
 * @param {{ issueDate?: string, paymentTermsDays?: number }} invoice
 */
export function dueOn(invoice) {
	const days = Number(invoice?.paymentTermsDays);
	if (!isDay(invoice?.issueDate) || !Number.isFinite(days) || days < 0) return '';
	return dueDay(/** @type {string} */ (invoice.issueDate), days);
}

/**
 * What the screens say about an issued invoice's payment: `paid` (with the day
 * of the last payment), `partially-paid`, `overdue` (the due day has passed and
 * it is not fully paid) or `open`. Overpaid counts as paid here; the figures
 * say by how much.
 *
 * @param {{ issueDate?: string, paymentTermsDays?: number, payments?: Payment[] }} invoice
 * @param {string | bigint} total
 * @param {string} today YYYY-MM-DD
 * @returns {{ status: 'paid' | 'partially-paid' | 'overdue' | 'open', paidOn: string | null }}
 */
export function paymentStatus(invoice, total, today) {
	const payments = invoice?.payments ?? [];
	const state = paymentState(total, paidUnits(payments));
	if (state === 'paid' || state === 'overpaid') {
		return { status: 'paid', paidOn: payments[payments.length - 1]?.paidOn ?? null };
	}
	const due = dueOn(invoice);
	if (due && today > due) return { status: 'overdue', paidOn: null };
	return { status: state === 'partially-paid' ? 'partially-paid' : 'open', paidOn: null };
}
