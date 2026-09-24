/**
 * The words the printed invoice needs, in one list.
 *
 * `documentModel` reads them by name and would otherwise fail on the first
 * missing one, in an export rather than in a test. Keeping the list here means
 * the catalogue can be checked against it, and the component that exports does
 * not have to remember seventeen key names.
 */

/** Everything under `invoice.document` in the catalogues. */
export const DOCUMENT_LABEL_KEYS = [
	'title',
	'titleCancellation',
	'invoiceDate',
	'deliveryDate',
	'dueDate',
	'customerNumber',
	'cancels',
	'position',
	'description',
	'quantity',
	'unit',
	'unitPrice',
	'vat',
	'lineNet',
	'subtotal',
	'vatOf',
	'totalCurrency',
	'amountDue',
	'netNote',
	'vatId',
	'taxNumber',
	'register',
	'registerCourt',
	'managingDirector',
	'email',
	'phone',
	'web',
	'bank',
	'iban',
	'bic',
	'accountHolder',
	'btc',
	'eth',
	'reference',
	'giroCaption',
	'giroHint',
	'paymentTerms',
	'paymentOnReceipt',
	'page'
];

/** The two sentences a tax mode can oblige an invoice to carry. */
export const NOTE_KEYS = ['invoice.note.kleinunternehmer', 'invoice.note.reverseCharge'];

/**
 * The label map the document and the PDF read.
 *
 * @param {(key: string) => string} translate a key to its text
 * @returns {Record<string, string>}
 */
export function documentLabels(translate) {
	/** @type {Record<string, string>} */
	const labels = {};
	for (const key of DOCUMENT_LABEL_KEYS) labels[key] = translate(`invoice.document.${key}`);
	// The note is looked up by the code stored on the invoice, so those two go
	// in under their code rather than their name.
	for (const key of NOTE_KEYS) labels[key] = translate(key);
	return labels;
}
