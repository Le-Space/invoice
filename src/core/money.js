/**
 * Money for invoices, in integer units of the invoice's currency.
 *
 * Floating-point euros drift (0.1 + 0.2), and an invoice whose lines do not add
 * up to its totals by one cent fails EN 16931's own consistency rules
 * (BR-CO-10, BR-CO-15) — and later the e-invoice validator. So every amount here
 * is an integer of the currency's smallest unit (cents, satoshi, wei; see
 * `currency.js`), computed as a BigInt and kept as a string, quantities are
 * scaled to ten-thousandths, and each figure is rounded exactly once: half away
 * from zero ("kaufmännisch"), the way German invoices are expected to round.
 */

import { VAT_CURRENCY, currencyOf } from './currency.js';

const QTY_SCALE = 10_000n;

/**
 * Integer division rounding half away from zero.
 *
 * @param {bigint} numerator
 * @param {bigint} divisor positive
 * @returns {bigint}
 */
function divRound(numerator, divisor) {
	const negative = numerator < 0n;
	const abs = negative ? -numerator : numerator;
	const quotient = abs / divisor;
	const remainder = abs - quotient * divisor;
	const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
	return negative ? -rounded : rounded;
}

/**
 * An amount in the smallest unit, or null when it is not a whole number of
 * them. Strings are what records carry; numbers are accepted where they are
 * safe integers, which is what cents were before this module knew currencies.
 *
 * @param {unknown} value
 * @returns {bigint | null}
 */
export function toUnits(value) {
	if (typeof value === 'bigint') return value;
	if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : null;
	if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
	return null;
}

/** @param {unknown} value */
function units(value) {
	const amount = toUnits(value);
	if (amount === null) throw new Error('An amount must be a whole number of the smallest unit.');
	return amount;
}

/**
 * Net amount of one invoice line (BT-131 = BT-129 × BT-146).
 *
 * @param {number} quantity may carry up to four decimals, e.g. 1.5 hours
 * @param {string | number | bigint} unitPrice net price per unit, in the smallest unit
 * @returns {bigint}
 */
export function lineNet(quantity, unitPrice) {
	const scaledQuantity = BigInt(Math.round(quantity * Number(QTY_SCALE)));
	return divRound(scaledQuantity * units(unitPrice), QTY_SCALE);
}

/**
 * VAT for one rate, taken on the sum of the net amounts at that rate
 * (BT-117 = BT-116 × BT-119 / 100). Computing it per line and adding up would be
 * a cent off now and then, and it is the per-rate figure that EN 16931 checks.
 *
 * @param {string | number | bigint} taxable
 * @param {number} ratePercent e.g. 19 or 7
 * @returns {bigint}
 */
export function vatAmount(taxable, ratePercent) {
	const basisPoints = BigInt(Math.round(ratePercent * 100));
	return divRound(units(taxable) * basisPoints, 10_000n);
}

/**
 * How VAT applies to the whole invoice.
 *
 * - `standard`: each line carries its rate (19, 7 or 0).
 * - `kleinunternehmer`: §19 UStG, no VAT may be shown at all.
 * - `reverse-charge`: the recipient owes the VAT (§13b UStG, B2B services
 *   into another EU country); the invoice shows none.
 *
 * @typedef {'standard' | 'kleinunternehmer' | 'reverse-charge'} TaxMode
 */

/**
 * The VAT category code EN 16931 uses for a line (BT-151).
 *
 * @param {number} ratePercent
 * @param {TaxMode} taxMode
 * @returns {'S' | 'Z' | 'E' | 'AE'}
 */
export function vatCategoryFor(ratePercent, taxMode) {
	if (taxMode === 'kleinunternehmer') return 'E';
	if (taxMode === 'reverse-charge') return 'AE';
	return ratePercent > 0 ? 'S' : 'Z';
}

/**
 * @typedef {{ quantity: number, unitPrice: string, vatRate: number }} PricedLine
 * @typedef {{ category: 'S' | 'Z' | 'E' | 'AE', rate: number, taxable: string, tax: string }} VatBreakdown
 */

/**
 * Line amounts, the VAT breakdown and the totals of an invoice, all in the
 * smallest unit of its currency, as strings.
 *
 * Without allowances or charges the EN 16931 totals collapse to three figures:
 * the sum of line nets (BT-106, equal to BT-109), the VAT total (BT-110) and
 * the gross total (BT-112), which is also the amount due (BT-115).
 *
 * @template {PricedLine} L
 * @param {L[]} lines
 * @param {TaxMode} [taxMode]
 */
export function computeTotals(lines, taxMode = 'standard') {
	const priced = lines.map((line) => {
		const vatRate = taxMode === 'standard' ? line.vatRate : 0;
		return {
			...line,
			vatRate,
			vatCategory: vatCategoryFor(vatRate, taxMode),
			net: lineNet(line.quantity, line.unitPrice)
		};
	});

	/** @type {Map<string, { category: VatBreakdown['category'], rate: number, taxable: bigint }>} */
	const groups = new Map();
	for (const line of priced) {
		const key = `${line.vatCategory}:${line.vatRate}`;
		const group = groups.get(key) ?? {
			category: line.vatCategory,
			rate: line.vatRate,
			taxable: 0n
		};
		group.taxable += line.net;
		groups.set(key, group);
	}

	const breakdown = [...groups.values()]
		.map((group) => ({ ...group, tax: vatAmount(group.taxable, group.rate) }))
		.sort((a, b) => b.rate - a.rate);

	const net = priced.reduce((sum, line) => sum + line.net, 0n);
	const tax = breakdown.reduce((sum, group) => sum + group.tax, 0n);
	const gross = net + tax;

	return {
		lines: priced.map((line) => ({ ...line, net: line.net.toString() })),
		/** @type {VatBreakdown[]} */
		vatBreakdown: breakdown.map((group) => ({
			category: group.category,
			rate: group.rate,
			taxable: group.taxable.toString(),
			tax: group.tax.toString()
		})),
		net: net.toString(),
		tax: tax.toString(),
		gross: gross.toString(),
		due: gross.toString()
	};
}

/**
 * A rate as it is typed or delivered ("0,0612", "95000.5"), as an exact
 * fraction, or null when it is not a positive decimal number.
 *
 * @param {unknown} text
 * @returns {{ numerator: bigint, scale: bigint } | null}
 */
export function parseRate(text) {
	const value = String(text ?? '')
		.trim()
		.replace(',', '.');
	const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
	if (!match) return null;
	const fraction = match[2] ?? '';
	const numerator = BigInt(`${match[1]}${fraction}`);
	if (numerator === 0n) return null;
	return { numerator, scale: 10n ** BigInt(fraction.length) };
}

/**
 * An amount in euro cents, converted at `eurPerUnit` euros for one whole unit
 * of `currency` (one dollar, one NYM), rounded once.
 *
 * This is what an invoice in another currency has to add: Art. 230 of the VAT
 * Directive and §16 Abs. 6 UStG want the VAT in euros, at a stated rate.
 *
 * @param {string | number | bigint} amount in the smallest unit of `currency`
 * @param {string} currency
 * @param {string} eurPerUnit
 * @returns {string | null} euro cents, or null for an unknown currency or a rate that is none
 */
export function inEuroCents(amount, currency, eurPerUnit) {
	const from = currencyOf(currency);
	const rate = parseRate(eurPerUnit);
	const euro = currencyOf(VAT_CURRENCY);
	if (!from || !rate || !euro) return null;
	const numerator = units(amount) * rate.numerator * 10n ** BigInt(euro.decimals);
	return divRound(numerator, rate.scale * 10n ** BigInt(from.decimals)).toString();
}

const grouping = new Intl.NumberFormat('de-DE', { useGrouping: true });

/**
 * "1.234,56" — the number without a currency, German grouping and decimal
 * comma, as in the invoice's table. Fiat shows all its decimals; crypto drops
 * trailing zeros down to two, because "0,001500000000000000 ETH" helps nobody.
 *
 * @param {string | number | bigint} amount in the smallest unit
 * @param {string} [currency]
 */
export function formatAmount(amount, currency = 'EUR') {
	const { decimals, kind } = currencyOf(currency) ?? { decimals: 2, kind: 'fiat' };
	const value = units(amount);
	const negative = value < 0n;
	const abs = negative ? -value : value;
	const divisor = 10n ** BigInt(decimals);
	let fraction = decimals > 0 ? (abs % divisor).toString().padStart(decimals, '0') : '';
	if (kind === 'crypto') {
		fraction = fraction.replace(/0+$/, '').padEnd(Math.min(2, decimals), '0');
	}
	const whole = grouping.format(abs / divisor);
	return `${negative ? '-' : ''}${whole}${fraction ? `,${fraction}` : ''}`;
}

/**
 * "1.234,56 €", "0,0015 BTC" — the amount with its currency, for the figures
 * somebody looks for: the sums and the amount due.
 *
 * @param {string | number | bigint} amount in the smallest unit
 * @param {string} [currency]
 */
export function formatMoney(amount, currency = 'EUR') {
	const symbol = currencyOf(currency)?.symbol ?? String(currency);
	return `${formatAmount(amount, currency)} ${symbol}`;
}

/**
 * Parse what someone types into a price field, into the smallest unit.
 *
 * German input first: a comma is the decimal separator ("95,50") and dots group
 * thousands ("1.234,56"). For a fiat currency a lone dot followed by one or two
 * digits is read as a decimal point too ("95.5"), because that is what a pasted
 * English number means, and a dot followed by exactly three digits stays a
 * thousands separator ("1.234" is 1234 €). For crypto a lone dot is always the
 * decimal point: an amount copied from a wallet ("0.001") is written that way,
 * and reading it as a thousand would be a thousandfold mistake. More decimals
 * than the currency has is refused rather than rounded — a price should never
 * silently change on its way in.
 *
 * @param {string | number} input
 * @param {string} [currency]
 * @returns {string | null} the smallest unit, or null when the input is not a price
 */
export function parseAmount(input, currency = 'EUR') {
	const target = currencyOf(currency);
	if (!target) return null;
	const text = String(input)
		.replace(/\s/g, '')
		.replace(/€/g, '')
		.replace(new RegExp(`^${target.code}|${target.code}$`, 'i'), '')
		.replace(/^\+/, '');
	if (!/^-?[\d.,]+$/.test(text) || !/\d/.test(text)) return null;

	const negative = text.startsWith('-');
	const unsigned = negative ? text.slice(1) : text;
	const lastComma = unsigned.lastIndexOf(',');
	const lastDot = unsigned.lastIndexOf('.');

	let decimalAt = -1;
	if (lastComma >= 0 && lastDot >= 0) {
		decimalAt = Math.max(lastComma, lastDot);
	} else if (lastComma >= 0) {
		if (unsigned.indexOf(',') !== lastComma) return null;
		decimalAt = lastComma;
	} else if (lastDot >= 0 && unsigned.indexOf('.') === lastDot) {
		const decimals = unsigned.length - lastDot - 1;
		if (target.kind === 'crypto' || decimals === 1 || decimals === 2) decimalAt = lastDot;
	}

	const integerPart = (decimalAt >= 0 ? unsigned.slice(0, decimalAt) : unsigned).replace(
		/[.,]/g,
		''
	);
	const fractionPart = decimalAt >= 0 ? unsigned.slice(decimalAt + 1) : '';
	if (!/^\d*$/.test(fractionPart) || fractionPart.length > target.decimals) return null;
	if (!/^\d*$/.test(integerPart) || (integerPart === '' && fractionPart === '')) return null;

	const amount = BigInt(`${integerPart || '0'}${fractionPart.padEnd(target.decimals, '0')}`);
	return (negative ? -amount : amount).toString();
}

/**
 * Parse a quantity: "1,5" or "1.5" hours, at most four decimals.
 *
 * @param {string | number} input
 * @returns {number | null}
 */
export function parseQuantity(input) {
	const text = String(input).trim().replace(',', '.');
	if (!/^\d+(\.\d{1,4})?$/.test(text)) return null;
	return Number(text);
}
