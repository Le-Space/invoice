import { describe, expect, it } from 'vitest';
import { duplicateGroups, duplicatedNumbers, isDuplicated, mustGiveWay } from './duplicates.js';

const issued = (/** @type {any} */ values) => ({
	state: 'issued',
	issuedAt: '2026-09-24T10:00:00.000Z',
	...values
});

describe('duplicateGroups', () => {
	it('finds nothing where every number went out once', () => {
		const groups = duplicateGroups([
			issued({ id: 'a', number: '2026-48213-001' }),
			issued({ id: 'b', number: '2026-48213-002' })
		]);
		expect(groups.size).toBe(0);
	});

	it('groups the invoices that share a number', () => {
		// One passkey, two devices, both offline: each read the numbers it could
		// see, and neither could see the other's.
		const groups = duplicateGroups([
			issued({ id: 'laptop', number: '2026-48213-007', issuedAt: '2026-09-24T09:00:00.000Z' }),
			issued({ id: 'phone', number: '2026-48213-007', issuedAt: '2026-09-24T11:00:00.000Z' }),
			issued({ id: 'other', number: '2026-48213-008' })
		]);
		expect(duplicatedNumbers(groups)).toEqual(['2026-48213-007']);
		expect(groups.get('2026-48213-007')?.map((invoice) => invoice.id)).toEqual(['laptop', 'phone']);
	});

	it('leaves drafts out, and a clash that has been taken back', () => {
		const groups = duplicateGroups([
			{ id: 'draft', state: 'draft' },
			issued({ id: 'a', number: '2026-1-001', cancelledBy: '2026-1-003' }),
			issued({ id: 'b', number: '2026-1-001' })
		]);
		expect(groups.size).toBe(0);
	});
});

describe('who gives way', () => {
	const groups = duplicateGroups([
		issued({ id: 'laptop', number: '2026-1-007', issuedAt: '2026-09-24T09:00:00.000Z' }),
		issued({ id: 'phone', number: '2026-1-007', issuedAt: '2026-09-24T11:00:00.000Z' })
	]);

	it('is the later one: the first invoice is the one somebody is holding', () => {
		expect(mustGiveWay({ id: 'phone', number: '2026-1-007' }, groups)).toBe(true);
		expect(mustGiveWay({ id: 'laptop', number: '2026-1-007' }, groups)).toBe(false);
	});

	it('is decided the same way on both devices, even at the same instant', () => {
		// No device can ask the other, so the rule has to be a function of what
		// both can see — the id breaks the tie, not whoever looks first.
		const sameInstant = duplicateGroups([
			issued({ id: 'bbb', number: '2026-1-009' }),
			issued({ id: 'aaa', number: '2026-1-009' })
		]);
		expect(mustGiveWay({ id: 'bbb', number: '2026-1-009' }, sameInstant)).toBe(true);
		expect(mustGiveWay({ id: 'aaa', number: '2026-1-009' }, sameInstant)).toBe(false);
	});

	it('says nothing about an invoice that is not in a clash', () => {
		expect(mustGiveWay({ id: 'x', number: '2026-1-002' }, groups)).toBe(false);
		expect(isDuplicated({ id: 'x', number: '2026-1-002' }, groups)).toBe(false);
		expect(isDuplicated({ id: 'phone', number: '2026-1-007' }, groups)).toBe(true);
	});
});
