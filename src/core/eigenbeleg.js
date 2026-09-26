/**
 * The self-issued receipt (Eigenbeleg): a document a business writes itself
 * for a payment that has no receipt from the other side — a fee paid on a
 * blockchain that issues no invoices, a payment whose invoice cannot be had.
 *
 * It is not an invoice. It has its own number range (`EB-2026-0001`), and
 * creating one never consumes an invoice number (UCEP extension `invoice`,
 * Le-Space/ucep-spec extensions/invoice.md). It says what was paid, when, how
 * much, to or from whom, and why there is no receipt from the other side; for
 * a crypto payment also the chain, the quantity, the rate with its source,
 * and the transaction. The issuer is copied in, and so is who asked for it: a
 * paired app's label and, when one was bound, its DID.
 *
 * Whether an Eigenbeleg is accepted, and up to which amount, is the tax
 * adviser's call.
 *
 * The arguments are those of `create-eigenbeleg`: amounts and quantities are
 * decimal strings, never floats, and are kept as they were given next to the
 * amount in the smallest unit of its currency.
 */

import { currencyOf } from './currency.js';

/** The number range of self-issued receipts, apart from every invoice circle. */
const NUMBER = /^EB-(\d{4})-(\d{4,})$/;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^\d+(\.\d+)?$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** @typedef {{ field: string, code: string }} Problem */

/**
 * The next number in the Eigenbeleg range of a year: EB-2026-0001, EB-2026-0002, …
 *
 * @param {string[]} numbers every Eigenbeleg number already given out
 * @param {string} year YYYY
 */
export function nextEigenbelegNumber(numbers, year) {
	let highest = 0;
	for (const number of numbers) {
		const m = NUMBER.exec(String(number ?? ''));
		if (m && m[1] === year) highest = Math.max(highest, Number(m[2]));
	}
	return `EB-${year}-${String(highest + 1).padStart(4, '0')}`;
}

/** @param {unknown} value */
const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * A decimal string in the smallest unit of `decimals`, or null when it is not
 * one or has more decimals than that.
 *
 * @param {unknown} value
 * @param {number} decimals
 */
function decimalUnits(value, decimals) {
	if (typeof value !== 'string' || !DECIMAL.test(value)) return null;
	const [whole, fraction = ''] = value.split('.');
	if (fraction.length > decimals) return null;
	return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`).toString();
}

/**
 * What is wrong with the arguments of `create-eigenbeleg`, field by field.
 * Empty when there is nothing.
 *
 * @param {any} args
 * @returns {Problem[]}
 */
export function eigenbelegProblems(args) {
	/** @type {Problem[]} */
	const problems = [];
	const add = (/** @type {string} */ field, /** @type {string} */ code) =>
		problems.push({ field, code });
	if (!args || typeof args !== 'object') return [{ field: '', code: 'invoice.eigenbeleg.args' }];

	if (!DAY.test(text(args.date))) add('date', 'invoice.eigenbeleg.date');
	if (args.direction !== 'outgoing' && args.direction !== 'incoming') {
		add('direction', 'invoice.eigenbeleg.direction');
	}
	if (!text(args.reason)) add('reason', 'invoice.eigenbeleg.reason');
	if (!text(args.description)) add('description', 'invoice.eigenbeleg.description');

	const currency = currencyOf(args.amount?.currency);
	if (!currency) {
		add('amount.currency', 'invoice.eigenbeleg.currency');
	} else if (decimalUnits(args.amount?.value, currency.decimals) === null) {
		add('amount.value', 'invoice.eigenbeleg.amount');
	}

	if (args.crypto !== undefined && args.crypto !== null) {
		const c = args.crypto;
		if (!/^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/.test(text(c.chain))) {
			add('crypto.chain', 'invoice.eigenbeleg.chain');
		}
		if (!text(c.symbol)) add('crypto.symbol', 'invoice.eigenbeleg.symbol');
		if (typeof c.quantity !== 'string' || !DECIMAL.test(c.quantity)) {
			add('crypto.quantity', 'invoice.eigenbeleg.quantity');
		}
		if (c.explorerUrl !== undefined && !/^https:\/\/[^\s]+$/.test(String(c.explorerUrl))) {
			add('crypto.explorerUrl', 'invoice.eigenbeleg.explorerUrl');
		}
		if (c.valuation !== undefined) {
			const v = c.valuation;
			if (typeof v?.rate !== 'string' || !DECIMAL.test(v.rate)) {
				add('crypto.valuation.rate', 'invoice.eigenbeleg.rate');
			}
			if (!text(v?.source)) add('crypto.valuation.source', 'invoice.eigenbeleg.rateSource');
			if (!INSTANT.test(text(v?.at))) add('crypto.valuation.at', 'invoice.eigenbeleg.rateAt');
		}
	}
	if (args.counterparty !== undefined && typeof args.counterparty?.name !== 'string') {
		add('counterparty.name', 'invoice.eigenbeleg.counterparty');
	}
	if (
		args.reference !== undefined &&
		(!text(args.reference?.system) || !text(args.reference?.id))
	) {
		add('reference', 'invoice.eigenbeleg.reference');
	}
	return problems;
}

/**
 * The record of an Eigenbeleg, frozen when it is made: the arguments as they
 * were given (trimmed), the amount also in the smallest unit of its currency,
 * the number, the issuer and who asked for it.
 *
 * @param {any} args the arguments of `create-eigenbeleg`, without problems
 * @param {{
 *   number: string,
 *   issuer: Record<string, any>,
 *   requestedBy: { label: string, did?: string | null, peerId?: string },
 *   createdAt?: string
 * }} act
 */
export function createEigenbeleg(
	args,
	{ number, issuer, requestedBy, createdAt = new Date().toISOString() }
) {
	const problems = eigenbelegProblems(args);
	if (problems.length > 0) {
		throw new Error(`This Eigenbeleg cannot be made: ${problems[0].field} (${problems[0].code})`);
	}
	if (!NUMBER.test(number)) throw new Error(`Not an Eigenbeleg number: ${number}`);
	const currency = /** @type {import('./currency.js').Currency} */ (
		currencyOf(args.amount.currency)
	);
	const crypto = args.crypto
		? {
				chain: text(args.crypto.chain),
				...(text(args.crypto.asset) ? { asset: text(args.crypto.asset) } : {}),
				symbol: text(args.crypto.symbol),
				quantity: args.crypto.quantity,
				...(text(args.crypto.txRef) ? { txRef: text(args.crypto.txRef) } : {}),
				...(args.crypto.explorerUrl ? { explorerUrl: String(args.crypto.explorerUrl) } : {}),
				...(args.crypto.valuation
					? {
							valuation: {
								rate: args.crypto.valuation.rate,
								rateCurrency: text(args.crypto.valuation.rateCurrency) || 'EUR',
								source: text(args.crypto.valuation.source),
								at: text(args.crypto.valuation.at)
							}
						}
					: {})
			}
		: null;
	return {
		kind: /** @type {'eigenbeleg'} */ ('eigenbeleg'),
		state: /** @type {'created'} */ ('created'),
		number,
		date: text(args.date),
		direction: args.direction,
		reason: text(args.reason),
		description: text(args.description),
		amount: {
			value: args.amount.value,
			currency: currency.code,
			units: /** @type {string} */ (decimalUnits(args.amount.value, currency.decimals)),
			decimals: currency.decimals
		},
		crypto,
		counterparty: args.counterparty
			? { name: text(args.counterparty.name), address: text(args.counterparty.address) }
			: null,
		reference: args.reference
			? { system: text(args.reference.system), id: text(args.reference.id) }
			: null,
		issuer: structuredClone(issuer),
		requestedBy: {
			label: text(requestedBy.label),
			...(requestedBy.did ? { did: requestedBy.did } : {}),
			...(requestedBy.peerId ? { peerId: requestedBy.peerId } : {})
		},
		createdAt
	};
}

/** @param {unknown} record */
export function isEigenbeleg(record) {
	return /** @type {any} */ (record)?.kind === 'eigenbeleg';
}
