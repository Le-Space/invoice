// Ported from Le-Space/belege (app/src/lib/i18n/index.js) at 9a40d22 and
// published here under the MIT license by its author. Changed: the app's own
// words (de.js) and the invoice core's catalogue (`invoice.*`, the words of
// the printed invoice) are one catalogue.
// The app's words, from one place.
//
// German only for now. Every string the interface shows comes from the
// catalogue in `de.js`, so English is one more file of the same shape and a
// locale switch, not a hunt through components. Kept deliberately smaller than
// Le-Space/simple-todo's svelte-i18n setup (apps/escrow01 src/lib/i18n/): with
// one language there is nothing to switch, and a plain lookup has no store to
// initialise before the first component renders.
import de from './de.js';
import core from '@le-space/invoice/i18n/de.json';

/** @typedef {string | string[] | { [key: string]: Catalogue }} Catalogue */

export const LOCALE = 'de';
const catalogue = /** @type {Catalogue} */ ({ ...de, invoice: { ...core.invoice, ...de.invoice } });

/**
 * @param {string} key dotted path, e.g. `consent.proceed`
 * @returns {Catalogue | undefined}
 */
function lookup(key) {
	/** @type {any} */
	let node = catalogue;
	for (const part of key.split('.')) {
		if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined;
		node = node[part];
	}
	return node;
}

/**
 * A sentence, with `{name}` placeholders filled in.
 *
 * A missing key shows as the key itself: visible, so a test or a reader finds
 * it, rather than an empty space nobody notices.
 *
 * @param {string} key
 * @param {Record<string, string | number>} [values]
 * @returns {string}
 */
export function t(key, values) {
	const text = lookup(key);
	if (typeof text !== 'string') return key;
	if (!values) return text;
	return text.replace(/\{(\w+)\}/g, (match, name) =>
		name in values ? String(values[name]) : match
	);
}

/**
 * A list of sentences (the technical explanations are lists).
 *
 * @param {string} key
 * @returns {string[]}
 */
export function list(key) {
	const value = lookup(key);
	return Array.isArray(value) ? value : [];
}

/**
 * Whether the catalogue has this key; for tests.
 *
 * @param {string} key
 */
export function has(key) {
	return lookup(key) !== undefined;
}
