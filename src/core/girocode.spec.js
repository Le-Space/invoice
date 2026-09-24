import { describe, expect, it } from 'vitest';
import { giroCodePayload, remittanceFor } from './girocode.js';

const transfer = {
	iban: 'DE89 3704 0044 0532 0130 00',
	name: 'Wolkenfabrik Hosting UG (haftungsbeschränkt)',
	bic: 'COBADEFFXXX',
	amountCents: 119_000,
	reference: 'Rechnung 2026-48213-001'
};

describe('giroCodePayload', () => {
	it('is twelve lines in the order EPC069-12 prescribes', () => {
		const lines = (giroCodePayload(transfer) ?? '').split('\n');
		expect(lines).toHaveLength(12);
		expect(lines.slice(0, 4)).toEqual(['BCD', '002', '1', 'SCT']);
		expect(lines[4]).toBe('COBADEFFXXX');
		expect(lines[5]).toBe('Wolkenfabrik Hosting UG (haftungsbeschränkt)');
		expect(lines[6]).toBe('DE89370400440532013000');
		expect(lines[7]).toBe('EUR1190.00');
		expect(lines[10]).toBe('Rechnung 2026-48213-001');
	});

	it('works without a BIC, which version 002 allows for SEPA', () => {
		const lines = (giroCodePayload({ ...transfer, bic: '' }) ?? '').split('\n');
		expect(lines[4]).toBe('');
		expect(lines[6]).toBe('DE89370400440532013000');
	});

	it('refuses what no transfer could carry', () => {
		expect(giroCodePayload({ ...transfer, iban: '' })).toBeNull();
		expect(giroCodePayload({ ...transfer, iban: 'not an iban' })).toBeNull();
		expect(giroCodePayload({ ...transfer, name: '   ' })).toBeNull();
		// A Storno is a negative amount; a credit transfer has no such thing.
		expect(giroCodePayload({ ...transfer, amountCents: -11_900 })).toBeNull();
		expect(giroCodePayload({ ...transfer, amountCents: 0 })).toBeNull();
	});

	it('stays inside the scheme’s 331 bytes', () => {
		const long = giroCodePayload({ ...transfer, reference: 'x'.repeat(400) });
		expect(long === null || new TextEncoder().encode(long).length <= 331).toBe(true);
	});

	it('names the invoice in the reference, which is what makes a payment matchable', () => {
		expect(remittanceFor('2026-48213-001')).toBe('Rechnung 2026-48213-001');
		expect(remittanceFor('2026-48213-001', { reference: 'Invoice' })).toBe(
			'Invoice 2026-48213-001'
		);
	});
});
