import { describe, expect, it } from 'vitest';
import {
	circleOf,
	defaultInvoiceSettings,
	isInvoiceSettingsKey,
	nextNumberFor,
	emptyIssuer,
	normaliseInvoiceSettings
} from './settings.js';
import { seriesDigits } from './series.js';

const ALICE = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
const BOB = 'did:key:z6MkfZ4yqRf8gTdZ1n1FKcZg7yAqW5mVtBs5S9xYzC2rQhTn';
const on = (/** @type {string} */ day) => new Date(`${day}T12:00:00`);

describe('the settings entry', () => {
	it('is neither a todo nor an invoice', () => {
		expect(isInvoiceSettingsKey('settings/invoice')).toBe(true);
		expect(isInvoiceSettingsKey('invoice/inv_1')).toBe(false);
	});

	it('starts a device with its own series and an empty issuer', () => {
		const settings = defaultInvoiceSettings(ALICE);
		expect(settings.circles[ALICE].pattern).toContain(seriesDigits(ALICE));
		expect(settings.issuer.name).toBe('');
	});
});

describe('normaliseInvoiceSettings', () => {
	it('keeps what the list already holds', () => {
		const stored = {
			issuer: { name: 'Wolkenfabrik UG', address: 'Musterstadt' },
			paymentTermsDays: 30
		};
		const settings = normaliseInvoiceSettings(stored, ALICE);
		expect(settings.issuer.name).toBe('Wolkenfabrik UG');
		expect(settings.paymentTermsDays).toBe(30);
	});

	it('fills in the footer groups an older settings entry never had', () => {
		// The issuer grew a bank, a register entry and crypto addresses after
		// the first invoices were written. Reading those settings back must not
		// produce an issuer without a bank.
		const stored = { issuer: { name: 'Wolkenfabrik UG', address: 'Musterstadt' } };
		const { issuer } = normaliseInvoiceSettings(stored, ALICE);
		expect(issuer.bank).toEqual({ name: '', iban: '', bic: '' });
		expect(issuer.register).toEqual({ court: '', number: '', managingDirector: '' });
		expect(issuer.crypto).toEqual({ btc: '', eth: '' });
		expect(issuer.logo).toBe('');
	});

	it('keeps only the Bitcoin and the Ethereum address, dropping those of an earlier build', () => {
		expect(emptyIssuer({ crypto: { btc: 'x', eth: 'y', nym: 'n', akt: 'a' } }).crypto).toEqual({
			btc: 'x',
			eth: 'y'
		});
		const stored = { issuer: { name: 'Wolkenfabrik UG', crypto: { nym: 'n', eth: 'y' } } };
		expect(normaliseInvoiceSettings(stored, ALICE).issuer.crypto).toEqual({ btc: '', eth: 'y' });
	});

	it('keeps a bank somebody has already filled in', () => {
		const stored = { issuer: { name: 'Wolkenfabrik UG', bank: { iban: 'DE00 0000' } } };
		const { issuer } = normaliseInvoiceSettings(stored, ALICE);
		expect(issuer.bank.iban).toBe('DE00 0000');
		expect(issuer.bank.bic).toBe('');
	});

	it('gives a second device its own circle without touching the first one', () => {
		const alice = defaultInvoiceSettings(ALICE);
		const onBobsDevice = normaliseInvoiceSettings(alice, BOB);
		expect(onBobsDevice.circles[ALICE]).toEqual(alice.circles[ALICE]);
		expect(onBobsDevice.circles[BOB].pattern).toContain(seriesDigits(BOB));
	});

	it('survives a list that has no settings at all', () => {
		expect(normaliseInvoiceSettings(null, ALICE).circles[ALICE]).toBeTruthy();
		expect(circleOf(normaliseInvoiceSettings(undefined, ALICE), ALICE).reset).toBe('yearly');
	});
});

describe('nextNumberFor', () => {
	it('hands this device the next number of its own series', () => {
		const settings = normaliseInvoiceSettings(null, ALICE);
		const issued = [`2026-${seriesDigits(ALICE)}-001`];
		expect(nextNumberFor(settings, ALICE, issued, on('2026-09-24'))).toBe(
			`2026-${seriesDigits(ALICE)}-002`
		);
	});

	it('lets two devices issue the same day without agreeing on anything', () => {
		// Both read the whole list, including each other's invoices, and still
		// count only their own — which is what makes offline issuing safe.
		const settings = normaliseInvoiceSettings(defaultInvoiceSettings(ALICE), BOB);
		const issued = [`2026-${seriesDigits(ALICE)}-001`, `2026-${seriesDigits(ALICE)}-002`];
		expect(nextNumberFor(settings, BOB, issued, on('2026-09-24'))).toBe(
			`2026-${seriesDigits(BOB)}-001`
		);
		expect(nextNumberFor(settings, ALICE, issued, on('2026-09-24'))).toBe(
			`2026-${seriesDigits(ALICE)}-003`
		);
	});
});
