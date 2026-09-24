import { describe, expect, it } from 'vitest';
import { circleBelongsToIdentity, circleForIdentity, seriesDigits } from './series.js';
import { nextInvoiceNumber } from './numbering.js';

const ALICE = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
const BOB = 'did:key:z6MkfZ4yqRf8gTdZ1n1FKcZg7yAqW5mVtBs5S9xYzC2rQhTn';

/** Local noon, so no time zone can move the date across a year boundary. */
const on = (/** @type {string} */ day) => new Date(`${day}T12:00:00`);

describe('seriesDigits', () => {
	it('is five digits', () => {
		expect(seriesDigits(ALICE)).toMatch(/^\d{5}$/);
	});

	it('is the same on every device the identity is on', () => {
		expect(seriesDigits(ALICE)).toBe(seriesDigits(ALICE));
	});

	it('ignores surrounding whitespace, so a pasted DID is the same identity', () => {
		expect(seriesDigits(`  ${ALICE}\n`)).toBe(seriesDigits(ALICE));
	});

	it('separates two identities', () => {
		expect(seriesDigits(BOB)).not.toBe(seriesDigits(ALICE));
	});

	it('refuses to invent a series without an identity', () => {
		expect(() => seriesDigits('')).toThrow();
		expect(() => seriesDigits(/** @type {never} */ (undefined))).toThrow();
	});

	it('spreads: a thousand identities fill most of the range', () => {
		const digits = new Set();
		for (let index = 0; index < 1000; index += 1) digits.add(seriesDigits(`${ALICE}#${index}`));
		expect(digits.size).toBeGreaterThan(990);
	});
});

describe('circleForIdentity', () => {
	it('puts the year first, then the identity, then the counter', () => {
		const circle = circleForIdentity(ALICE);
		expect(circle.pattern).toBe(`{YYYY}-${seriesDigits(ALICE)}-{NNN}`);
		expect(circle.reset).toBe('yearly');
	});

	it('hands out the first number of the year', () => {
		expect(nextInvoiceNumber(circleForIdentity(ALICE), [], on('2026-09-24'))).toBe(
			`2026-${seriesDigits(ALICE)}-001`
		);
	});

	it('counts up within the identity, and restarts with the year', () => {
		const circle = circleForIdentity(ALICE);
		const issued = [`2026-${seriesDigits(ALICE)}-001`, `2026-${seriesDigits(ALICE)}-002`];
		expect(nextInvoiceNumber(circle, issued, on('2026-12-31'))).toBe(
			`2026-${seriesDigits(ALICE)}-003`
		);
		expect(nextInvoiceNumber(circle, issued, on('2027-01-02'))).toBe(
			`2027-${seriesDigits(ALICE)}-001`
		);
	});

	it('does not count another identity as its own', () => {
		// The point of the whole design: two devices that never met still write
		// numbers that cannot collide, because each reads only its own series.
		const alice = circleForIdentity(ALICE);
		const bobsInvoices = [
			`2026-${seriesDigits(BOB)}-001`,
			`2026-${seriesDigits(BOB)}-002`,
			`2026-${seriesDigits(BOB)}-003`
		];
		expect(nextInvoiceNumber(alice, bobsInvoices, on('2026-09-24'))).toBe(
			`2026-${seriesDigits(ALICE)}-001`
		);
	});

	it('takes a wider counter when a year needs more than 999 invoices', () => {
		expect(circleForIdentity(ALICE, { width: 4 }).pattern).toMatch(/-\{NNNN\}$/);
		expect(() => circleForIdentity(ALICE, { width: 0 })).toThrow();
	});

	it('refuses a circle that would repeat its numbers every year', () => {
		// `validatePattern` catches it; the year is in the pattern, so this can
		// only happen through `reset: 'monthly'`, which also wants the month.
		expect(() => circleForIdentity(ALICE, { reset: 'monthly' })).toThrow();
	});
});

describe('circleBelongsToIdentity', () => {
	it('knows its own circle from somebody else’s', () => {
		const circle = circleForIdentity(ALICE);
		expect(circleBelongsToIdentity(circle, ALICE)).toBe(true);
		expect(circleBelongsToIdentity(circle, BOB)).toBe(false);
	});

	it('says no rather than throwing on a circle that is not one', () => {
		expect(circleBelongsToIdentity(/** @type {never} */ ({}), ALICE)).toBe(false);
	});
});
