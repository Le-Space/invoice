import { describe, expect, it } from 'vitest';
import { toChainUnits } from './currency.js';
import {
	computeTotals,
	formatAmount,
	formatMoney,
	inEuroCents,
	lineNet,
	parseAmount,
	parseQuantity,
	parseRate,
	toUnits,
	vatAmount
} from './money.js';

/** The amounts put a no-break space before the currency; compare with a plain one. */
const plain = (/** @type {string} */ text) => text.replace(/\s/g, ' ');

describe('lineNet', () => {
	it('multiplies quantity by the unit price', () => {
		expect(lineNet(3, '9500')).toBe(28500n);
		expect(lineNet(1.5, '9500')).toBe(14250n);
	});

	it('rounds half away from zero, once, at the line', () => {
		// 0.333 h × 10.00 € = 3.33 €; 2.5 × 0.01 € = 0.025 € → 0.03 €
		expect(lineNet(0.333, '1000')).toBe(333n);
		expect(lineNet(2.5, '1')).toBe(3n);
		expect(lineNet(2.5, '-1')).toBe(-3n);
	});

	it('does not drift on quantities binary floats cannot represent', () => {
		// 1.005 × 100.00 € must be 100.50 €, not 100.49 €
		expect(lineNet(1.005, '10000')).toBe(10050n);
	});

	it('stays exact for large amounts', () => {
		// 123456789 × 99999999 / 10000 = 1234567877654.3211
		expect(lineNet(12345.6789, '99999999')).toBe(1234567877654n);
	});

	it('stays exact far beyond what a JSON number holds', () => {
		expect(lineNet(2.5, '1200000000000000000000')).toBe(3000000000000000000000n);
	});

	it('refuses a price that is not a whole number of the smallest unit', () => {
		expect(() => lineNet(1, '9,50')).toThrow();
		expect(() => lineNet(1, 0.5)).toThrow();
	});
});

describe('toUnits', () => {
	it('takes strings, safe integers and bigints', () => {
		expect(toUnits('-12')).toBe(-12n);
		expect(toUnits(9500)).toBe(9500n);
		expect(toUnits(7n)).toBe(7n);
	});

	it('refuses fractions and unsafe numbers', () => {
		expect(toUnits('1.5')).toBeNull();
		expect(toUnits(1.5)).toBeNull();
		expect(toUnits(2 ** 60)).toBeNull();
		expect(toUnits(undefined)).toBeNull();
	});
});

describe('vatAmount', () => {
	it('takes the rate on the taxable amount and rounds half away from zero', () => {
		expect(vatAmount('10000', 19)).toBe(1900n);
		expect(vatAmount('10050', 19)).toBe(1910n); // 19.095 → 19.10
		expect(vatAmount('1050', 7)).toBe(74n); // 0.735 → 0.74
		expect(vatAmount('10000', 0)).toBe(0n);
	});
});

describe('computeTotals', () => {
	const lines = [
		{ quantity: 10, unitPrice: '9500', vatRate: 19 },
		{ quantity: 1, unitPrice: '4990', vatRate: 7 },
		{ quantity: 2.5, unitPrice: '9500', vatRate: 19 }
	];

	it('groups VAT by rate and adds the totals up exactly', () => {
		const totals = computeTotals(lines);
		expect(totals.lines.map((line) => line.net)).toEqual(['95000', '4990', '23750']);
		expect(totals.vatBreakdown).toEqual([
			{ category: 'S', rate: 19, taxable: '118750', tax: '22563' },
			{ category: 'S', rate: 7, taxable: '4990', tax: '349' }
		]);
		expect(totals.net).toBe('123740');
		expect(totals.tax).toBe('22912');
		expect(totals.gross).toBe('146652');
		expect(totals.due).toBe('146652');
	});

	it('shows no VAT for a Kleinunternehmer, whatever rate a line carries', () => {
		const totals = computeTotals(lines, 'kleinunternehmer');
		expect(totals.vatBreakdown).toEqual([{ category: 'E', rate: 0, taxable: '123740', tax: '0' }]);
		expect(totals.gross).toBe('123740');
	});

	it('shows no VAT under reverse charge and marks the category AE', () => {
		const totals = computeTotals(lines, 'reverse-charge');
		expect(totals.vatBreakdown).toEqual([{ category: 'AE', rate: 0, taxable: '123740', tax: '0' }]);
	});

	it('marks a 0 % line zero-rated under standard taxation', () => {
		const totals = computeTotals([{ quantity: 1, unitPrice: '1000', vatRate: 0 }]);
		expect(totals.vatBreakdown).toEqual([{ category: 'Z', rate: 0, taxable: '1000', tax: '0' }]);
	});

	it('keeps whatever else a line carries', () => {
		const totals = computeTotals([
			{ quantity: 1, unitPrice: '1000', vatRate: 19, description: 'Beratung', todoKey: 'todo_1' }
		]);
		expect(totals.lines[0]).toMatchObject({ description: 'Beratung', todoKey: 'todo_1' });
	});

	it('adds up amounts in the smallest unit of any currency', () => {
		// 3 × 1.5 NYM, 19 % VAT: 4.5 NYM net, 0.855 NYM VAT
		const totals = computeTotals([{ quantity: 3, unitPrice: '1500000', vatRate: 19 }]);
		expect(totals.net).toBe('4500000');
		expect(totals.tax).toBe('855000');
		expect(totals.gross).toBe('5355000');
	});
});

describe('parseRate', () => {
	it('reads a positive decimal, with comma or dot, exactly', () => {
		expect(parseRate('0,0612')).toEqual({ numerator: 612n, scale: 10000n });
		expect(parseRate('95000.5')).toEqual({ numerator: 950005n, scale: 10n });
		expect(parseRate('2')).toEqual({ numerator: 2n, scale: 1n });
	});

	it.each(['', '0', '0,000', '-1', '1e3', 'abc', '1.2.3'])('refuses %j', (input) => {
		expect(parseRate(input)).toBeNull();
	});
});

describe('inEuroCents', () => {
	it('converts at the rate for one whole unit, rounding once', () => {
		// 0.855 NYM × 0.0612 €/NYM = 0.052326 € → 0.05 €
		expect(inEuroCents('855000', 'NYM', '0.0612')).toBe('5');
		// 190.00 USD × 0.9234 €/USD = 175.446 € → 175.45 €
		expect(inEuroCents('19000', 'USD', '0,9234')).toBe('17545');
		// 0.0015 BTC × 95000 €/BTC = 142.50 €
		expect(inEuroCents('150000', 'BTC', '95000')).toBe('14250');
		// 0.1 ETH (invoiced in 10⁻⁸) × 3210.987654 €/ETH = 321.0987654 € → 321.10 €
		expect(inEuroCents('10000000', 'ETH', '3210.987654')).toBe('32110');
	});

	it('knows no currency it does not know, and no rate that is none', () => {
		expect(inEuroCents('100', 'XYZ', '1')).toBeNull();
		expect(inEuroCents('100', 'USD', '0')).toBeNull();
	});
});

describe('formatMoney', () => {
	it('uses German grouping and the decimal comma for euros', () => {
		expect(plain(formatMoney('146652'))).toBe('1.466,52 €');
		expect(plain(formatMoney('5'))).toBe('0,05 €');
		expect(plain(formatMoney('-12345'))).toBe('-123,45 €');
	});

	it('names any other currency by its code', () => {
		expect(plain(formatMoney('123456789', 'USD'))).toBe('1.234.567,89 USD');
		expect(plain(formatMoney('150000', 'BTC'))).toBe('0,0015 BTC');
		expect(plain(formatMoney('150000', 'ETH'))).toBe('0,0015 ETH');
		expect(plain(formatMoney('5355000', 'NYM'))).toBe('5,355 NYM');
		expect(plain(formatMoney('1000000', 'NYM'))).toBe('1,00 NYM');
	});
});

describe('an amount read with the decimals its record says', () => {
	it('uses them, not the table', () => {
		expect(formatAmount('150', { code: 'NYM', decimals: 2 })).toBe('1,50');
		expect(plain(formatMoney('150', { code: 'ETH', decimals: 2 }))).toBe('1,50 ETH');
		expect(parseAmount('1,5', { code: 'ETH', decimals: 18 })).toBe('1500000000000000000');
		expect(inEuroCents('1000000000000000000', { code: 'ETH', decimals: 18 }, '3000')).toBe(
			'300000'
		);
	});

	it('refuses decimals that are none', () => {
		expect(parseAmount('1', { code: 'NYM', decimals: -1 })).toBeNull();
		expect(inEuroCents('1', { code: 'NYM', decimals: 1.5 }, '1')).toBeNull();
	});
});

describe('formatAmount', () => {
	it('is the number alone, as in the table', () => {
		expect(formatAmount('146652')).toBe('1.466,52');
		expect(formatAmount('100000000', 'BTC')).toBe('1,00');
		expect(formatAmount('-1', 'BTC')).toBe('-0,00000001');
	});
});

describe('parseAmount', () => {
	it.each([
		['95', '9500'],
		['95,5', '9550'],
		['95,50', '9550'],
		['1.234,56', '123456'],
		['1.234', '123400'],
		['1.234.567', '123456700'],
		['95.5', '9550'],
		['1,234.56', '123456'],
		['  95,00 € ', '9500'],
		['-12,34', '-1234'],
		[',5', '50']
	])('reads %j as %s cents', (input, cents) => {
		expect(parseAmount(input)).toBe(cents);
	});

	it.each(['', 'abc', '12,345', '1,2,3', '9,5x', '-', '.'])('refuses %j', (input) => {
		expect(parseAmount(input)).toBeNull();
	});

	it('reads a crypto amount into its smallest unit, a lone dot as the decimal point', () => {
		expect(parseAmount('0.001', 'BTC')).toBe('100000');
		expect(parseAmount('1.234', 'NYM')).toBe('1234000');
		expect(parseAmount('1.234,5 NYM', 'NYM')).toBe('1234500000');
		// Ether is invoiced in 10⁻⁸, so a ninth decimal is refused.
		expect(parseAmount('0,0015', 'ETH')).toBe('150000');
		expect(parseAmount('0,000000001', 'ETH')).toBeNull();
		expect(parseAmount('12.5 USDC', 'USDC')).toBe('12500000');
	});

	it('refuses more decimals than the currency has, and a currency it does not know', () => {
		expect(parseAmount('0,123456789', 'BTC')).toBeNull();
		expect(parseAmount('1,005', 'USD')).toBeNull();
		expect(parseAmount('1', 'XYZ')).toBeNull();
	});
});

describe('parseQuantity', () => {
	it('reads decimal commas and dots', () => {
		expect(parseQuantity('1,5')).toBe(1.5);
		expect(parseQuantity('2.25')).toBe(2.25);
		expect(parseQuantity(3)).toBe(3);
	});

	it('refuses negatives, words and more than four decimals', () => {
		expect(parseQuantity('-1')).toBeNull();
		expect(parseQuantity('zwei')).toBeNull();
		expect(parseQuantity('1,23456')).toBeNull();
	});
});

describe('toChainUnits', () => {
	it('scales an Ether amount from the invoice’s 10⁻⁸ to wei, and leaves the rest alone', () => {
		expect(toChainUnits('150000', 'ETH')).toBe('1500000000000000');
		expect(toChainUnits('150000', 'BTC')).toBe('150000');
		expect(toChainUnits('-1', 'POL')).toBe('-10000000000');
		expect(toChainUnits('1', 'XYZ')).toBeNull();
		expect(toChainUnits('1.5', 'ETH')).toBeNull();
	});
});
