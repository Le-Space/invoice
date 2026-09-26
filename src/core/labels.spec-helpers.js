import { documentLabels } from './labels.js';

/**
 * The document's labels from a catalogue, as the app looks them up.
 *
 * @param {any} catalogue
 */
export function labelsFrom(catalogue) {
	const root = { invoice: catalogue.invoice };
	return documentLabels(
		(/** @type {string} */ key) =>
			key.split('.').reduce((/** @type {any} */ node, part) => node?.[part], root) ?? ''
	);
}
