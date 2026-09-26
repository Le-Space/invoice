import { describe, expect, it } from 'vitest';
import de from '../i18n/de.json';
import en from '../i18n/en.json';
import {
	createEigenbeleg,
	eigenbelegProblems,
	isEigenbeleg,
	nextEigenbelegNumber
} from './eigenbeleg.js';
import {
	EIGENBELEG_LABEL_KEYS,
	eigenbelegFileName,
	eigenbelegLabels,
	eigenbelegPdfBytes,
	eigenbelegRows
} from './eigenbeleg-pdf.js';

/** The example of the spec (extensions/invoice.md), made-up data. */
const args = {
	date: '2026-09-01',
	direction: 'outgoing',
	reason: 'The network charges fees on-chain and issues no invoice.',
	description: 'Network fee for a lease payment',
	amount: { value: '12.34', currency: 'EUR' },
	crypto: {
		chain: 'cosmos:akashnet-2',
		asset: 'cosmos:akashnet-2/slip44:118',
		symbol: 'AKT',
		quantity: '4.200000',
		txRef: '0'.repeat(64),
		explorerUrl: 'https://explorer.example.com/tx/0000',
		valuation: {
			rate: '2.938095',
			rateCurrency: 'EUR',
			source: 'coingecko:history',
			at: '2026-09-01T12:00:00+00:00'
		}
	},
	counterparty: { name: 'Stromwerk Test AG', address: 'unknown' },
	reference: { system: 'belege', id: '01J0000000000000000000000A' }
};
const ISSUER = { name: 'Wolkenfabrik Hosting UG', address: 'Musterstraße 1\n12345 Musterstadt' };
const act = {
	number: 'EB-2026-0001',
	issuer: ISSUER,
	requestedBy: { label: 'Belege, Laptop', did: 'did:key:z6MkExample' },
	createdAt: '2026-09-26T10:00:00+02:00'
};

const lookup = (/** @type {any} */ catalogue) => (/** @type {string} */ key) =>
	key.split('.').reduce((node, part) => node?.[part], catalogue) ?? '';

describe('nextEigenbelegNumber', () => {
	it('counts per year in its own range, four digits', () => {
		expect(nextEigenbelegNumber([], '2026')).toBe('EB-2026-0001');
		expect(nextEigenbelegNumber(['EB-2026-0001', 'EB-2026-0007', 'EB-2025-0042'], '2026')).toBe(
			'EB-2026-0008'
		);
	});

	it('never counts an invoice number', () => {
		expect(nextEigenbelegNumber(['2026-00000-003', 'RE-2026-0009'], '2026')).toBe('EB-2026-0001');
	});
});

describe('eigenbelegProblems', () => {
	it('finds none in the spec’s example, and none without the optional parts', () => {
		expect(eigenbelegProblems(args)).toEqual([]);
		const { crypto, counterparty, reference, ...plain } = args;
		expect(eigenbelegProblems(plain)).toEqual([]);
	});

	it('names each field that is wrong', () => {
		const fields = (/** @type {any} */ changed) =>
			eigenbelegProblems({ ...args, ...changed }).map((p) => p.field);
		expect(fields({ date: '1.9.2026' })).toEqual(['date']);
		expect(fields({ direction: 'sideways' })).toEqual(['direction']);
		expect(fields({ reason: '  ' })).toEqual(['reason']);
		expect(fields({ description: '' })).toEqual(['description']);
		// Never a float, never more decimals than the currency has.
		expect(fields({ amount: { value: 12.34, currency: 'EUR' } })).toEqual(['amount.value']);
		expect(fields({ amount: { value: '12.345', currency: 'EUR' } })).toEqual(['amount.value']);
		expect(fields({ amount: { value: '-1', currency: 'EUR' } })).toEqual(['amount.value']);
		expect(fields({ amount: { value: '1', currency: 'XYZ' } })).toEqual(['amount.currency']);
		expect(fields({ crypto: { ...args.crypto, chain: 'akash' } })).toEqual(['crypto.chain']);
		expect(fields({ crypto: { ...args.crypto, quantity: 4.2 } })).toEqual(['crypto.quantity']);
		expect(fields({ crypto: { ...args.crypto, explorerUrl: 'http://x' } })).toEqual([
			'crypto.explorerUrl'
		]);
		expect(
			fields({
				crypto: { ...args.crypto, valuation: { ...args.crypto.valuation, at: '2026-09-01' } }
			})
		).toEqual(['crypto.valuation.at']);
		expect(fields({ reference: { system: 'belege' } })).toEqual(['reference']);
		expect(eigenbelegProblems(null)).toEqual([{ field: '', code: 'invoice.eigenbeleg.args' }]);
	});

	it('has a text for every problem in both languages', () => {
		for (const catalogue of [de, en]) {
			for (const key of Object.keys(de.invoice.eigenbeleg).filter((k) => k !== 'doc')) {
				expect(lookup(catalogue)(`invoice.eigenbeleg.${key}`)).not.toBe('');
			}
		}
	});
});

describe('createEigenbeleg', () => {
	it('freezes the arguments, the amount in cents, the issuer and who asked', () => {
		const record = createEigenbeleg(args, act);
		expect(isEigenbeleg(record)).toBe(true);
		expect(record).toMatchObject({
			kind: 'eigenbeleg',
			state: 'created',
			number: 'EB-2026-0001',
			amount: { value: '12.34', currency: 'EUR', units: '1234', decimals: 2 },
			crypto: { symbol: 'AKT', quantity: '4.200000', txRef: '0'.repeat(64) },
			reference: { system: 'belege', id: '01J0000000000000000000000A' },
			requestedBy: { label: 'Belege, Laptop', did: 'did:key:z6MkExample' },
			createdAt: '2026-09-26T10:00:00+02:00'
		});
		ISSUER.name = 'changed later';
		expect(record.issuer.name).toBe('Wolkenfabrik Hosting UG');
		ISSUER.name = 'Wolkenfabrik Hosting UG';
	});

	it('refuses arguments with problems, and a number from another range', () => {
		expect(() => createEigenbeleg({ ...args, reason: '' }, act)).toThrow(/reason/);
		expect(() => createEigenbeleg(args, { ...act, number: '2026-00000-001' })).toThrow(/number/);
	});
});

describe('the Eigenbeleg as a PDF', () => {
	const labels = eigenbelegLabels(lookup(de));

	it('has every word it prints, in both languages', () => {
		for (const catalogue of [de, en]) {
			const words = eigenbelegLabels(lookup(catalogue));
			expect(EIGENBELEG_LABEL_KEYS.filter((key) => !words[key])).toEqual([]);
		}
	});

	it('prints the payment, the reason, the chain details and who asked', () => {
		const rows = Object.fromEntries(eigenbelegRows(createEigenbeleg(args, act), labels));
		expect(rows).toMatchObject({
			'Datum der Zahlung': '01.09.2026',
			Richtung: 'Ausgabe',
			Betrag: '12,34 €',
			'Warum es keinen Beleg der Gegenseite gibt':
				'The network charges fees on-chain and issues no invoice.',
			Menge: '4,200000 AKT',
			Kurs: '2,938095 EUR/AKT (coingecko:history, 2026-09-01T12:00:00+00:00)',
			Transaktion: '0'.repeat(64),
			Referenz: 'belege: 01J0000000000000000000000A',
			'Angefordert von': 'Belege, Laptop · did:key:z6MkExample'
		});
	});

	it('leaves out what nobody gave', () => {
		const { crypto, counterparty, reference, ...plain } = args;
		const rows = eigenbelegRows(createEigenbeleg(plain, act), labels).map(([label]) => label);
		expect(rows).not.toContain('Menge');
		expect(rows).not.toContain('Gegenseite');
		expect(rows).not.toContain('Referenz');
	});

	it('is the same bytes every time it is drawn, so its hash holds', async () => {
		const record = createEigenbeleg(args, act);
		const first = await eigenbelegPdfBytes(record, labels);
		await new Promise((resolve) => setTimeout(resolve, 1100));
		const second = await eigenbelegPdfBytes(record, labels);
		expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
	});

	it('is a PDF, named after its number', async () => {
		const record = createEigenbeleg(args, act);
		const bytes = await eigenbelegPdfBytes(record, labels);
		expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
		expect(eigenbelegFileName(record)).toBe('Eigenbeleg-EB-2026-0001.pdf');
	});
});
