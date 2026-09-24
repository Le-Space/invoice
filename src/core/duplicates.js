/**
 * Two invoices, one number.
 *
 * Every identity issues in a series of its own, so this cannot happen between
 * two people. It can happen between two devices that are the *same* identity —
 * one passkey on a laptop and a phone — when both are offline and both issue:
 * each reads the numbers it can see, and neither can see the other's. The same
 * follows a restore, where a device comes back holding a circle it shares.
 *
 * The rule is that nobody renumbers an invoice a customer already has. §14
 * Abs. 4 Nr. 4 UStG wants a number given out once; when it went out twice, the
 * correction is a Storno and a new invoice (§31 Abs. 5 UStDV) — not a quiet
 * edit, which an append-only log could not perform anyway.
 *
 * So the app detects it, says so, and offers the correction. Which of the two
 * gives way is decided here rather than by whoever clicks first.
 */

/**
 * @typedef {{
 *   id: string,
 *   number?: string,
 *   state?: string,
 *   issuedAt?: string,
 *   cancels?: string,
 *   cancelledBy?: string
 * }} Issued
 */

/**
 * Invoices that share a number, grouped by it.
 *
 * A number that has already been taken back is not a clash any more: the Storno
 * carries its own number, and the invoice it cancels is settled.
 *
 * @template {Issued} T
 * @param {T[]} invoices
 * @returns {Map<string, T[]>}
 */
export function duplicateGroups(invoices) {
	/** @type {Map<string, T[]>} */
	const byNumber = new Map();
	for (const invoice of invoices) {
		if (invoice.state !== 'issued' || !invoice.number) continue;
		if (invoice.cancelledBy) continue;
		byNumber.set(invoice.number, [...(byNumber.get(invoice.number) ?? []), invoice]);
	}

	/** @type {Map<string, T[]>} */
	const clashes = new Map();
	for (const [number, group] of byNumber) {
		if (group.length > 1) clashes.set(number, group.slice().sort(byAge));
	}
	return clashes;
}

/**
 * Oldest first: the invoice that went out first is the one that keeps its
 * number, because it is the one somebody is already holding.
 *
 * `issuedAt` decides; where two devices managed the same instant, the id does,
 * so both devices reach the same answer without talking to each other.
 *
 * @param {Issued} a
 * @param {Issued} b
 */
function byAge(a, b) {
	const first = String(a.issuedAt ?? '');
	const second = String(b.issuedAt ?? '');
	if (first !== second) return first < second ? -1 : 1;
	return String(a.id).localeCompare(String(b.id));
}

/**
 * Whether this invoice is the one that has to give way.
 *
 * @template {Issued} T
 * @param {T} invoice
 * @param {Map<string, T[]>} groups
 */
export function mustGiveWay(invoice, groups) {
	const group = invoice.number ? groups.get(invoice.number) : undefined;
	if (!group || group.length < 2) return false;
	return group[0].id !== invoice.id;
}

/**
 * Whether this invoice is in a clash at all.
 *
 * @template {Issued} T
 * @param {T} invoice
 * @param {Map<string, T[]>} groups
 */
export function isDuplicated(invoice, groups) {
	const group = invoice.number ? groups.get(invoice.number) : undefined;
	return Boolean(group && group.length > 1);
}

/**
 * The numbers that went out twice, for saying so in one sentence.
 *
 * @param {Map<string, unknown[]>} groups
 */
export function duplicatedNumbers(groups) {
	return [...groups.keys()].sort();
}
