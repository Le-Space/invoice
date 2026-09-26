import { describe, expect, it } from 'vitest';
import de from '../i18n/de.json';
import { eurRateOf, lineFromTransaction, rateSourceName } from './crypto-lines.js';
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

describe('an invoice in NYM made from a transaction', () => {
	const ISSUER = {
		name: 'Wolkenfabrik Hosting UG',
		address: 'Musterstraße 1\n12345 Musterstadt',
		crypto: { nym: 'n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp8hacc' }
	};

	it('can be issued with the booking’s rate, and prints where it came from', () => {
		const draft = emptyDraft({ currency: 'NYM', issueDate: '2026-09-24' });
		const made = lineFromTransaction(received, moneyUnit(draft), options);
		if (!('line' in made)) throw new Error(made.problem);
		const ready = {
			...draft,
			customer: {
				name: 'Stromwerk Test AG',
				address: 'Beispielweg 2\n54321 Beispielstadt',
				vatId: ''
			},
			lines: [made.line],
			eurRate: eurRateOf(received)
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
			subtitle: '12,5 NYM zu 0,0612 € je NYM (CoinGecko, 24.09.2026)',
			details: [`Transaktion ${HASH}`]
		});
		// 19 % of 12.5 NYM = 2.375 NYM, at 0.0612 € = 0.14535 € → 0.15 €
		expect(invoice.totals.taxInEuroCents).toBe('15');
	});
});
