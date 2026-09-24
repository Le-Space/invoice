/**
 * Which series an invoice belongs to, derived from the identity that issues it.
 *
 * Two devices of the same business can both be offline and both issue an
 * invoice. A single shared counter cannot survive that: whoever replicates
 * second finds the number already taken. UStAE 14.5 Abs. 10 is the way out —
 * §14 Abs. 4 Nr. 4 UStG asks for a number given out *einmalig*, not
 * *lückenlos*, and several series are explicitly allowed. So every identity
 * writes in a series of its own, and no two devices ever need to agree:
 *
 *   2026-48213-001, 2026-48213-002, …   one identity
 *   2026-70914-001, …                   another
 *
 * The year comes first because that is what invoices are sorted and filed by,
 * and it is what makes the yearly reset safe.
 */

import { validatePattern } from './numbering.js';

/** How many digits stand for the identity. */
export const SERIES_DIGITS = 5;

const MODULUS = 10 ** SERIES_DIGITS;

/**
 * Five digits for an identity, stable for as long as the identity is.
 *
 * Not the DID's own last characters: a DID is base58, where `a2doK` and
 * `A2DOK` are different strings. An invoice number is read aloud, typed into a
 * bank transfer and scanned out of a PDF, and none of those survive a case
 * distinction. Digits do.
 *
 * FNV-1a, because nothing here needs a cryptographic property: the segment
 * only has to be stable and to spread. Two identities that land on the same
 * five digits share one series — `nextInvoiceNumber` then reads both their
 * numbers and counts past the highest, so a collision costs a shared series
 * and never a duplicate number.
 *
 * @param {string} identityId the OrbitDB identity id (the passkey DID)
 * @returns {string} five digits, zero-padded
 */
export function seriesDigits(identityId) {
	if (typeof identityId !== 'string' || identityId.trim() === '') {
		throw new Error('An invoice series needs the identity that issues it.');
	}

	let hash = 0x811c9dc5;
	for (const byte of new TextEncoder().encode(identityId.trim())) {
		hash ^= byte;
		// FNV prime 16777619, in 32-bit arithmetic that stays exact in doubles.
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return String(hash % MODULUS).padStart(SERIES_DIGITS, '0');
}

/**
 * The circle an identity starts with: `2026-48213-001`, restarting each year.
 *
 * The digits sit in the pattern as literal text, which is what keeps the series
 * apart: `parseInvoiceNumber` only reads back numbers written to this very
 * pattern, so another identity's numbers are invisible to this counter.
 *
 * @param {string} identityId
 * @param {{ reset?: import('./numbering.js').ResetRule, width?: number }} [options]
 * @returns {import('./numbering.js').NumberCircle}
 */
export function circleForIdentity(identityId, { reset = 'yearly', width = 3 } = {}) {
	if (!Number.isInteger(width) || width < 1 || width > 9) {
		throw new Error('The counter is between one and nine digits wide.');
	}

	const pattern = `{YYYY}-${seriesDigits(identityId)}-{${'N'.repeat(width)}}`;
	const problem = validatePattern(pattern, reset);
	if (problem) throw new Error(problem);
	return { pattern, reset, start: null };
}

/**
 * Whether a circle is the one this identity would be given.
 *
 * A settings panel may edit the pattern, and a series migrated from another
 * program keeps its own; both are allowed. This only answers whether the
 * circle still carries this identity's digits, which is what the duplicate
 * check needs to know before it blames another device.
 *
 * @param {import('./numbering.js').NumberCircle} circle
 * @param {string} identityId
 */
export function circleBelongsToIdentity(circle, identityId) {
	return typeof circle?.pattern === 'string' && circle.pattern.includes(seriesDigits(identityId));
}
