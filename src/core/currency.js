/**
 * The currencies an invoice can be written in.
 *
 * Every amount on an invoice is an integer of the currency's smallest unit on
 * the invoice — cents, satoshi, uNYM — kept in a string, because a float cannot
 * hold anything exactly. `decimals` says where the decimal point goes.
 *
 * For most currencies that unit is the one the chain or the bank counts in. For
 * Ether and the other 18-decimal coins it is not: an invoice with eighteen
 * decimals is one nobody can read or check, so the invoice counts in 10⁻⁸
 * (as Bitcoin does), and `unitDecimals` says what a payment code or a booking
 * has to scale to (`toChainUnits`).
 *
 * The crypto entries match the assets Belege knows (Le-Space/belege,
 * app/src/lib/assets/registry.js): the same symbols, and `unitDecimals` equal
 * to its decimals, so an invoice line made from a booking and a booking made
 * from an invoice speak of the same unit.
 */

/**
 * @typedef {object} Currency
 * @property {string} code ISO 4217 for fiat, the ticker for crypto
 * @property {number} decimals digits of the smallest unit on the invoice
 * @property {number} unitDecimals digits of the smallest unit on the chain or at the bank
 * @property {'fiat' | 'crypto'} kind
 * @property {string} symbol what the printed invoice writes after an amount
 */

/** @type {Readonly<Record<string, Currency>>} */
export const CURRENCIES = Object.freeze({
	EUR: { code: 'EUR', decimals: 2, unitDecimals: 2, kind: 'fiat', symbol: '€' },
	USD: { code: 'USD', decimals: 2, unitDecimals: 2, kind: 'fiat', symbol: 'USD' },
	CHF: { code: 'CHF', decimals: 2, unitDecimals: 2, kind: 'fiat', symbol: 'CHF' },
	GBP: { code: 'GBP', decimals: 2, unitDecimals: 2, kind: 'fiat', symbol: 'GBP' },
	BTC: { code: 'BTC', decimals: 8, unitDecimals: 8, kind: 'crypto', symbol: 'BTC' },
	ETH: { code: 'ETH', decimals: 8, unitDecimals: 18, kind: 'crypto', symbol: 'ETH' },
	USDC: { code: 'USDC', decimals: 6, unitDecimals: 6, kind: 'crypto', symbol: 'USDC' },
	NYM: { code: 'NYM', decimals: 6, unitDecimals: 6, kind: 'crypto', symbol: 'NYM' },
	AKT: { code: 'AKT', decimals: 6, unitDecimals: 6, kind: 'crypto', symbol: 'AKT' },
	POL: { code: 'POL', decimals: 8, unitDecimals: 18, kind: 'crypto', symbol: 'POL' }
});

/**
 * The currencies a new invoice may be written in. NYM and AKT stay known, so
 * that invoices issued in them still read and print as they were issued, but
 * no new one is written in them: there is no address for them to be paid to.
 */
export const INVOICE_CURRENCIES = Object.freeze(
	Object.keys(CURRENCIES).filter((code) => code !== 'NYM' && code !== 'AKT')
);

/** The currency German VAT is owed in, whatever the invoice is written in. */
export const VAT_CURRENCY = 'EUR';

/**
 * @param {string | null | undefined} code
 * @returns {Currency | null}
 */
export function currencyOf(code) {
	const key = String(code ?? '').toUpperCase();
	return Object.hasOwn(CURRENCIES, key) ? CURRENCIES[key] : null;
}

/**
 * An invoice amount in the unit a payment code or a booking counts in: wei for
 * Ether, the same number for everything whose invoice unit is its chain unit.
 *
 * @param {string} amount integer string in the invoice's unit
 * @param {string | { code: string, decimals: number }} unit the currency, or — for
 *   an invoice — its code with the decimals the record was written with
 * @returns {string | null} null for an unknown currency, decimals finer than
 *   the chain's, or an amount that is none
 */
export function toChainUnits(amount, unit) {
	const currency = currencyOf(typeof unit === 'string' ? unit : unit?.code);
	const decimals = typeof unit === 'string' ? currency?.decimals : unit?.decimals;
	if (!currency || !Number.isInteger(decimals) || !/^-?\d+$/.test(String(amount ?? ''))) {
		return null;
	}
	const shift = currency.unitDecimals - /** @type {number} */ (decimals);
	if (shift < 0) return null;
	return (BigInt(amount) * 10n ** BigInt(shift)).toString();
}
