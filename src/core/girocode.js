/**
 * The GiroCode: an invoice that fills in the transfer by itself.
 *
 * A banking app that scans it takes recipient, IBAN, amount and reference from
 * the code, so nobody retypes an IBAN and nobody forgets the invoice number in
 * the reference — which is the single most common reason a payment cannot be
 * matched to its invoice.
 *
 * The payload is EPC069-12 ("Quick Response Code: Guidelines to Enable the
 * Data Capture for the Initiation of a SEPA Credit Transfer"): twelve lines in
 * a fixed order, at most 331 bytes, encoded as UTF-8.
 */

/** Version 002 allows the BIC to be left out for a SEPA transfer. */
const SERVICE_TAG = 'BCD';
const VERSION = '002';
const ENCODING = '1'; // UTF-8
const IDENTIFICATION = 'SCT'; // SEPA Credit Transfer

/**
 * The reference a bank shows the payer, and the app needs to match it back.
 *
 * @param {string} number
 * @param {{ reference?: string }} [labels]
 */
export function remittanceFor(number, labels = {}) {
	const prefix = labels.reference ?? 'Rechnung';
	return `${prefix} ${number}`.trim();
}

/**
 * The payload of the code, or null when the invoice cannot carry one.
 *
 * Reasons it cannot: no IBAN in the settings, nothing to pay, or an amount the
 * scheme does not take — EPC069-12 is for euro amounts between 0.01 and
 * 999,999,999.99, and a Storno is a negative amount that no transfer can carry.
 *
 * @param {{ iban: string, name: string, bic?: string, amountCents: number, reference: string }} transfer
 * @returns {string | null}
 */
export function giroCodePayload({ iban, name, bic = '', amountCents, reference }) {
	const account = String(iban ?? '')
		.replace(/\s+/g, '')
		.toUpperCase();
	const beneficiary = String(name ?? '')
		.trim()
		.slice(0, 70);
	if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(account) || beneficiary === '') return null;
	if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 99_999_999_999)
		return null;

	const amount = `EUR${(amountCents / 100).toFixed(2)}`;
	const lines = [
		SERVICE_TAG,
		VERSION,
		ENCODING,
		IDENTIFICATION,
		String(bic ?? '')
			.replace(/\s+/g, '')
			.toUpperCase(),
		beneficiary,
		account,
		amount,
		'', // purpose code
		'', // structured reference — mutually exclusive with the text below
		String(reference ?? '').slice(0, 140),
		'' // beneficiary to originator information
	];

	const payload = lines.join('\n');
	// The scheme's own limit. A reference that long is the only realistic way
	// to exceed it, and a code nobody can scan is worse than no code.
	return new TextEncoder().encode(payload).length > 331 ? null : payload;
}
