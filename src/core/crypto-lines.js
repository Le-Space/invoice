/**
 * Invoice lines from crypto transactions, as Belege books them.
 *
 * A booking in Belege (Le-Space/belege, app/src/lib/assets/valuation.js)
 * keeps what moved next to what it was worth:
 *
 *   asset      the symbol
 *   quantity   integer of the smallest unit on the chain, signed, as a string
 *   decimals   the asset's decimals on the chain
 *   valuation  { rate, currency: 'EUR', source, at }: EUR per whole unit
 *   amountCents  the euro value it was booked with
 *   txRef / chainTxRef  the exchange's reference, the on-chain hash
 *
 * An invoice line made from it says what it charges in the invoice's
 * currency, and keeps where it came from: the quantity, the rate with its
 * source and moment, and the transaction — on the line itself, frozen with
 * the invoice, so the line can be traced back to the booking years later
 * (GoBD: nachvollziehbar) without asking Belege.
 *
 * Two invoices can be made from a transaction:
 *
 * - in the asset itself (an invoice in NYM for 12 NYM received): the price is
 *   the quantity, rescaled from the chain's decimals to the invoice's;
 * - in euros: the price is the euro value Belege booked, and the line says
 *   how much of what was worth that, at which rate.
 *
 * Any other pairing (an invoice in dollars for a NYM transaction) would need a
 * rate Belege did not record, and is refused rather than guessed.
 */

import { currencyOf, VAT_CURRENCY } from './currency.js';
import { formatDay, formatRate } from './document.js';
import { parseRate, toUnits } from './money.js';
import { emptyLine } from './records.js';

/** How a rate source is named on an invoice; Belege's codes (valuation.js). */
export const RATE_SOURCES = Object.freeze({
	coingecko: 'CoinGecko',
	kraken: 'Kraken',
	ecb: 'EZB-Referenzkurs',
	trade: 'Preis des Handels',
	manual: 'von Hand eingetragen'
});

/**
 * @typedef {object} CryptoTransaction a Belege booking of a crypto movement
 * @property {string} asset
 * @property {string} quantity smallest unit on the chain, signed
 * @property {number} decimals
 * @property {{ rate: string, currency?: string, source: string, at: string }} valuation
 * @property {number} [amountCents] the euro value it was booked with, signed
 * @property {string} [date] YYYY-MM-DD
 * @property {string} [txRef]
 * @property {string} [chainTxRef]
 */

/**
 * What a line keeps of the transaction it was made from.
 *
 * @typedef {{
 *   asset: string,
 *   quantity: string,
 *   decimals: number,
 *   rate: string,
 *   rateSource: string,
 *   rateAt: string,
 *   txRef?: string,
 *   chainTxRef?: string
 * }} LineSource
 */

/**
 * @param {unknown} tx
 * @returns {tx is CryptoTransaction}
 */
function isCryptoTransaction(tx) {
	const t = /** @type {any} */ (tx);
	return (
		typeof t?.asset === 'string' &&
		toUnits(t.quantity) !== null &&
		typeof t.quantity === 'string' &&
		Number.isInteger(t.decimals) &&
		t.decimals >= 0 &&
		parseRate(t.valuation?.rate) !== null &&
		typeof t.valuation?.source === 'string' &&
		typeof t.valuation?.at === 'string'
	);
}

/** @param {bigint} v */
const abs = (v) => (v < 0n ? -v : v);

/**
 * Integer division rounding half away from zero.
 *
 * @param {bigint} numerator
 * @param {bigint} divisor positive
 */
function divRound(numerator, divisor) {
	const quotient = numerator / divisor;
	return (numerator - quotient * divisor) * 2n >= divisor ? quotient + 1n : quotient;
}

const grouping = new Intl.NumberFormat('de-DE');

/**
 * A quantity in whole units, German style, every decimal it has and no
 * trailing zeros: "12,5", "0,001500000000000123". Also for an asset the
 * invoice cannot be written in (Kraken lists more than `currency.js`).
 *
 * @param {bigint} units positive
 * @param {number} decimals
 */
function unitsText(units, decimals) {
	const divisor = 10n ** BigInt(decimals);
	const fraction = decimals > 0 ? (units % divisor).toString().padStart(decimals, '0') : '';
	const trimmed = fraction.replace(/0+$/, '');
	return `${grouping.format(units / divisor)}${trimmed ? `,${trimmed}` : ''}`;
}

/** @param {string} source */
export function rateSourceName(source) {
	return Object.hasOwn(RATE_SOURCES, source)
		? RATE_SOURCES[/** @type {keyof typeof RATE_SOURCES} */ (source)]
		: source;
}

/**
 * The rate a transaction was booked at, as an invoice in its asset states it
 * for the VAT in euros (`eurRate` on the record). The month rule of §16
 * Abs. 6 UStG is checked by `draftProblems` against the delivery date.
 *
 * @param {CryptoTransaction} tx
 * @returns {{ eurPerUnit: string, source: string, date: string } | null}
 */
export function eurRateOf(tx) {
	if (!isCryptoTransaction(tx) || (tx.valuation.currency ?? 'EUR') !== 'EUR') return null;
	return {
		eurPerUnit: tx.valuation.rate,
		source: rateSourceName(tx.valuation.source),
		date: tx.valuation.at.slice(0, 10)
	};
}

/**
 * An invoice line for a crypto transaction, or the reason there is none.
 *
 * The line charges one unit (`quantity: 1`) at the transaction's amount; the
 * figures the reader needs to check it go into `subtitle` and `details`, and
 * the transaction itself into `source`.
 *
 * @param {unknown} tx a Belege booking
 * @param {{ code: string, decimals: number }} unit the invoice's `moneyUnit`
 * @param {{
 *   description: string,
 *   vatRate?: number,
 *   unit?: string,
 *   labels: { subtitle: string, transaction: string }
 * }} options `labels.subtitle` with {quantity}, {asset}, {rate}, {source}, {date};
 *   `labels.transaction` with {hash}
 * @returns {{ line: ReturnType<typeof emptyLine> & { source: LineSource } } | { problem: string }}
 */
export function lineFromTransaction(
	tx,
	unit,
	{ description, vatRate = 19, unit: unitName, labels }
) {
	if (!isCryptoTransaction(tx)) return { problem: 'invoice.problem.cryptoTransaction' };
	const invoiceCurrency = currencyOf(unit?.code);
	if (!invoiceCurrency || !Number.isInteger(unit.decimals) || unit.decimals < 0) {
		return { problem: 'invoice.problem.currency' };
	}
	const asset = tx.asset.toUpperCase();
	const moved = abs(BigInt(tx.quantity));
	if (moved === 0n) return { problem: 'invoice.problem.cryptoTransaction' };

	/** @type {bigint} */
	let price;
	if (invoiceCurrency.code === asset) {
		// The chain may count finer than the invoice (wei against 10⁻⁸):
		// rounded once, and the exact quantity stays in `source`.
		const shift = unit.decimals - tx.decimals;
		price = shift >= 0 ? moved * 10n ** BigInt(shift) : divRound(moved, 10n ** BigInt(-shift));
	} else if (invoiceCurrency.code === VAT_CURRENCY && unit.decimals === 2) {
		if (Number.isSafeInteger(tx.amountCents)) {
			// What Belege booked, so the invoice and the books say the same.
			price = abs(BigInt(/** @type {number} */ (tx.amountCents)));
		} else {
			const rate = /** @type {{ numerator: bigint, scale: bigint }} */ (
				parseRate(tx.valuation.rate)
			);
			price = divRound(moved * rate.numerator * 100n, rate.scale * 10n ** BigInt(tx.decimals));
		}
	} else {
		return { problem: 'invoice.problem.cryptoCurrency' };
	}
	if (price === 0n) return { problem: 'invoice.problem.cryptoTransaction' };

	const quantityText = unitsText(moved, tx.decimals);
	const hash = tx.chainTxRef || tx.txRef || '';

	return {
		line: {
			...emptyLine({
				description,
				quantity: 1,
				...(unitName ? { unit: unitName } : {}),
				unitPrice: price.toString(),
				vatRate
			}),
			subtitle: labels.subtitle
				.replace('{quantity}', quantityText)
				.replaceAll('{asset}', asset)
				.replace('{rate}', formatRate(tx.valuation.rate))
				.replace('{source}', rateSourceName(tx.valuation.source))
				.replace('{date}', formatDay(tx.valuation.at.slice(0, 10))),
			details: hash ? [labels.transaction.replace('{hash}', hash)] : [],
			source: {
				asset,
				quantity: tx.quantity,
				decimals: tx.decimals,
				rate: tx.valuation.rate,
				rateSource: tx.valuation.source,
				rateAt: tx.valuation.at,
				...(tx.txRef ? { txRef: tx.txRef } : {}),
				...(tx.chainTxRef ? { chainTxRef: tx.chainTxRef } : {})
			}
		}
	};
}
