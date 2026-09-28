import { describe, expect, it } from 'vitest';
import de from '../i18n/de.json';
import {
	cryptoLine,
	cryptoSubtotals,
	eurRateOf,
	lineFromTransaction,
	parseCryptoQuantity,
	rateSourceName
} from './crypto-lines.js';
import { documentModel } from './document.js';
import { documentLabels } from './labels.js';
import { draftProblems, emptyDraft, issue, moneyUnit } from './records.js';

const LABELS = de.invoice.cryptoLine;
const HASH = `0x${'ab12'.repeat(16)}`;

/** A made-up Belege booking: 12.5 NYM received, valued at CoinGecko's rate. */
const received = {
	asset: 'NYM',
	quantity: '12500000',
	decimals: 6,
	valuation: { rate: '0.0612', currency: 'EUR', source: 'coingecko', at: '2026-09-24T12:00:00Z' },
	amountCents: 77,
	date: '2026-09-24',
	chainTxRef: HASH
};

const NYM = { code: 'NYM', decimals: 6 };
const EUR = { code: 'EUR', decimals: 2 };
const options = { description: 'Mixnode-Betrieb September', labels: LABELS };

describe('lineFromTransaction', () => {
	it('charges the quantity itself on an invoice in the same asset', () => {
		const result = lineFromTransaction(received, NYM, options);
		if (!('line' in result)) throw new Error(result.problem);
		expect(result.line).toMatchObject({
			description: 'Mixnode-Betrieb September',
			quantity: 1,
			unitPrice: '12500000',
			vatRate: 19,
			subtitle: '12,5 NYM zu 0,0612 € je NYM (CoinGecko, 24.09.2026)',
			details: [`Transaktion ${HASH}`]
		});
	});

	it('keeps where the line came from, exactly', () => {
		const result = lineFromTransaction(received, NYM, options);
		if (!('line' in result)) throw new Error(result.problem);
		expect(result.line.source).toEqual({
			asset: 'NYM',
			quantity: '12500000',
			decimals: 6,
			rate: '0.0612',
			rateSource: 'coingecko',
			rateAt: '2026-09-24T12:00:00Z',
			chainTxRef: HASH
		});
	});

	it('charges what moved, whichever way it moved', () => {
		const sent = { ...received, quantity: '-12500000', amountCents: -77 };
		const result = lineFromTransaction(sent, NYM, options);
		expect('line' in result && result.line.unitPrice).toBe('12500000');
	});

	it('rounds wei to the invoice’s decimals once, and keeps the exact quantity', () => {
		const eth = {
			...received,
			asset: 'ETH',
			quantity: '1500000000000000123',
			decimals: 18,
			valuation: { ...received.valuation, rate: '3210.98' }
		};
		const result = lineFromTransaction(eth, { code: 'ETH', decimals: 8 }, options);
		if (!('line' in result)) throw new Error(result.problem);
		expect(result.line.unitPrice).toBe('150000000');
		expect(result.line.subtitle).toBe(
			'1,500000000000000123 ETH zu 3.210,98 € je ETH (CoinGecko, 24.09.2026)'
		);
		expect(result.line.source.quantity).toBe('1500000000000000123');
	});

	it('charges the euro value Belege booked on an invoice in euros', () => {
		const result = lineFromTransaction(received, EUR, options);
		expect('line' in result && result.line.unitPrice).toBe('77');
	});

	it('works the euro value out from quantity and rate where none was booked', () => {
		// 12.5 × 0.0612 € = 0.765 € → 0.77 €
		const { amountCents, ...unbooked } = received;
		const result = lineFromTransaction(unbooked, EUR, options);
		expect('line' in result && result.line.unitPrice).toBe('77');
	});

	it('takes an asset the invoice cannot be written in, on an invoice in euros', () => {
		const dot = {
			...received,
			asset: 'DOT',
			quantity: '35000000000',
			decimals: 10,
			amountCents: 1540
		};
		const result = lineFromTransaction(dot, EUR, options);
		if (!('line' in result)) throw new Error(result.problem);
		expect(result.line.unitPrice).toBe('1540');
		expect(result.line.subtitle).toMatch(/^3,5 DOT zu/);
	});

	it('refuses a pairing it would have to guess a rate for', () => {
		expect(lineFromTransaction(received, { code: 'USD', decimals: 2 }, options)).toEqual({
			problem: 'invoice.problem.cryptoCurrency'
		});
		expect(lineFromTransaction(received, { code: 'BTC', decimals: 8 }, options)).toEqual({
			problem: 'invoice.problem.cryptoCurrency'
		});
		expect(lineFromTransaction(received, { code: 'XYZ', decimals: 2 }, options)).toEqual({
			problem: 'invoice.problem.currency'
		});
	});

	it('refuses what is not a crypto booking', () => {
		const bank = { amountCents: 1000, currency: 'EUR', date: '2026-09-24' };
		expect(lineFromTransaction(bank, EUR, options)).toEqual({
			problem: 'invoice.problem.cryptoTransaction'
		});
		expect(lineFromTransaction({ ...received, quantity: '0' }, NYM, options)).toEqual({
			problem: 'invoice.problem.cryptoTransaction'
		});
		expect(lineFromTransaction({ ...received, quantity: '1.5' }, NYM, options)).toEqual({
			problem: 'invoice.problem.cryptoTransaction'
		});
	});
});

describe('eurRateOf', () => {
	it('is the rate the booking was valued at, named for the reader', () => {
		expect(eurRateOf(received)).toEqual({
			eurPerUnit: '0.0612',
			source: 'CoinGecko',
			date: '2026-09-24'
		});
		expect(rateSourceName('trade')).toBe('Preis des Handels');
		expect(rateSourceName('somewhere')).toBe('somewhere');
	});
});

describe('an invoice in USDC made from a transaction', () => {
	/** A made-up Belege booking: 12.5 USDC received on Base, valued at CoinGecko's rate. */
	const usdcReceived = {
		...received,
		asset: 'USDC',
		valuation: { ...received.valuation, rate: '0.9123' },
		amountCents: 1140
	};
	const ISSUER = {
		name: 'Wolkenfabrik Hosting UG',
		address: 'Musterstraße 1\n12345 Musterstadt',
		crypto: { eth: '0x0000000000000000000000000000000000000001' }
	};

	it('can be issued with the booking’s rate, and prints where it came from', () => {
		const draft = { ...emptyDraft({ currency: 'USDC', issueDate: '2026-09-24' }), network: 'base' };
		const made = lineFromTransaction(usdcReceived, moneyUnit(draft), options);
		if (!('line' in made)) throw new Error(made.problem);
		const ready = {
			...draft,
			customer: {
				name: 'Stromwerk Test AG',
				address: 'Beispielweg 2\n54321 Beispielstadt',
				vatId: ''
			},
			lines: [made.line],
			eurRate: eurRateOf(usdcReceived)
		};
		expect(draftProblems(ready, { issuer: ISSUER })).toEqual([]);

		const invoice = issue(ready, { number: '2026-00000-001', issuer: ISSUER, issuedBy: 'did' });
		expect(invoice.lines[0].source.chainTxRef).toBe(HASH);

		const catalogue = /** @type {any} */ ({ invoice: de.invoice });
		const labels = documentLabels(
			(key) =>
				key.split('.').reduce((/** @type {any} */ node, part) => node?.[part], catalogue) ?? ''
		);
		const model = documentModel(invoice, labels);
		expect(model.rows[0]).toMatchObject({
			unitPrice: '12,50',
			subtitle: '12,5 USDC zu 0,9123 € je USDC (CoinGecko, 24.09.2026)',
			details: [`Transaktion ${HASH}`]
		});
		// 19 % of 12.5 USDC = 2.375 USDC, at 0.9123 € = 2.1667125 € → 2.17 €
		expect(invoice.totals.taxInEuroCents).toBe('217');
	});
});

describe('a crypto line entered by hand', () => {
	it('reads a quantity as it is typed', () => {
		expect(parseCryptoQuantity('12,5')).toEqual({ units: '125', decimals: 1 });
		expect(parseCryptoQuantity('0.0015')).toEqual({ units: '15', decimals: 4 });
		expect(parseCryptoQuantity('1.000,25')).toEqual({ units: '100025', decimals: 2 });
		expect(parseCryptoQuantity('1 000')).toEqual({ units: '1000', decimals: 0 });
		for (const bad of ['', '0', '0,0', '-1', 'abc', '1,2,3'])
			expect(parseCryptoQuantity(bad)).toBeNull();
	});

	it('prices quantity × rate in euros, and says so under the line', () => {
		const result = cryptoLine(
			{
				asset: 'nym',
				quantity: '12,5',
				rate: '0,0612',
				rateSource: 'coingecko',
				rateAt: '2026-09-24',
				hash: HASH
			},
			EUR,
			options
		);
		if (!('line' in result)) throw new Error(result.problem);
		// 12.5 × 0.0612 € = 0.765 € → 77 cents
		expect(result.line).toMatchObject({
			description: 'Mixnode-Betrieb September',
			quantity: 1,
			unitPrice: '77',
			subtitle: '12,5 NYM zu 0,0612 € je NYM (CoinGecko, 24.09.2026)',
			details: [`Transaktion ${HASH}`],
			source: {
				asset: 'NYM',
				quantity: '125',
				decimals: 1,
				rate: '0.0612',
				rateSource: 'coingecko',
				rateAt: '2026-09-24'
			}
		});
	});

	it('refuses what is missing: asset, quantity, rate, its source or its day', () => {
		const good = {
			asset: 'AKT',
			quantity: '3',
			rate: '2,94',
			rateSource: 'kraken',
			rateAt: '2026-09-24'
		};
		expect('line' in cryptoLine(good, EUR, options)).toBe(true);
		for (const change of [
			{ asset: '' },
			{ quantity: '0' },
			{ rate: '' },
			{ rateSource: ' ' },
			{ rateAt: '24.09.2026' }
		]) {
			expect(cryptoLine({ ...good, ...change }, EUR, options)).toEqual({
				problem: 'invoice.problem.cryptoTransaction'
			});
		}
	});
});

describe('cryptoSubtotals', () => {
	const nym = (/** @type {string} */ quantity, /** @type {number} */ decimals, net = '100') => ({
		quantity: 1,
		net,
		source: { asset: 'NYM', quantity, decimals }
	});

	it('adds up each asset, on the finer scale, with what its lines come to', () => {
		const sums = cryptoSubtotals([
			nym('125', 1, '77'),
			{ quantity: 1, net: '5000', description: 'Beratung' },
			{ quantity: 2, net: '588', source: { asset: 'AKT', quantity: '1000000', decimals: 6 } },
			nym('12500000', 6, '76')
		]);
		expect(sums).toEqual([
			{ asset: 'NYM', quantity: '25', net: '153' },
			{ asset: 'AKT', quantity: '2', net: '588' }
		]);
	});

	it('leaves out a line in fractions of a unit: its crypto cannot be counted', () => {
		expect(cryptoSubtotals([{ ...nym('125', 1), quantity: 1.5 }])).toEqual([]);
		expect(cryptoSubtotals([])).toEqual([]);
	});

	it('shows up in the invoice’s totals, above the subtotal', () => {
		const draft = {
			...emptyDraft({ currency: 'EUR', issueDate: '2026-09-24' }),
			deliveryDate: '2026-09-24',
			customer: { name: 'Wolkenfabrik Hosting GmbH', address: 'Wolkenweg 1\n12345 Musterstadt' }
		};
		const a = cryptoLine(
			{
				asset: 'NYM',
				quantity: '12,5',
				rate: '0,0612',
				rateSource: 'coingecko',
				rateAt: '2026-09-24'
			},
			EUR,
			options
		);
		const b = cryptoLine(
			{ asset: 'AKT', quantity: '3', rate: '2,94', rateSource: 'kraken', rateAt: '2026-09-24' },
			EUR,
			{ ...options, description: 'Lease' }
		);
		if (!('line' in a) || !('line' in b)) throw new Error('no line');
		const model = documentModel({ ...draft, lines: [a.line, b.line] }, documentLabels(key(de)));
		expect(model.totals.slice(0, 3).map((t) => [t.label, t.value])).toEqual([
			['davon 12,5 NYM', '0,77\u00a0€'],
			['davon 3 AKT', '8,82\u00a0€'],
			['Zwischensumme ohne USt.', '9,59\u00a0€']
		]);
	});
});

/** A translate function over the catalogue. @param {any} catalogue */
function key(catalogue) {
	return (/** @type {string} */ path) =>
		path.split('.').reduce((node, part) => node?.[part], catalogue) ?? path;
}
