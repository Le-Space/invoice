import { describe, expect, it } from 'vitest';
import de from '../i18n/de.json';
import en from '../i18n/en.json';
import { DOCUMENT_LABEL_KEYS, NOTE_KEYS, documentLabels } from './labels.js';

/** @param {any} catalogue */
const lookup = (catalogue) => (/** @type {string} */ key) =>
	key.split('.').reduce((node, part) => node?.[part], catalogue) ?? '';

describe('the document’s labels', () => {
	it('are all in both catalogues', () => {
		for (const catalogue of [de, en]) {
			const translate = lookup(catalogue);
			const missing = [...DOCUMENT_LABEL_KEYS.map((k) => `invoice.document.${k}`), ...NOTE_KEYS]
				.filter((key) => translate(key) === '');
			expect(missing).toEqual([]);
		}
	});

	it('keep the placeholders the document fills in', () => {
		for (const catalogue of [de, en]) {
			const labels = documentLabels(lookup(catalogue));
			expect(labels.vatOf).toContain('{rate}');
			expect(labels.vatOf).toContain('{base}');
			expect(labels.paymentTerms).toContain('{amount}');
			expect(labels.paymentTerms).toContain('{date}');
			expect(labels.paymentTerms).toContain('{number}');
			expect(labels.page).toContain('{page}');
			expect(labels.page).toContain('{pages}');
		}
	});
});
