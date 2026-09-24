/**
 * What every invoice of this list starts from: who is charging, and in which
 * series the numbers are handed out.
 *
 * It lives in the list itself rather than in this browser, because the list is
 * what travels between the devices of one business — a second device must not
 * invent a second issuer address. The series is the exception it cannot be:
 * each identity gets its own, and that is exactly what lets both devices issue
 * while neither can see the other (see `series.js`).
 */

import { nextInvoiceNumber } from './numbering.js';
import { circleForIdentity } from './series.js';

/** Where the settings sit in the list. Not a todo, not an invoice. */
export const INVOICE_SETTINGS_KEY = 'settings/invoice';

/** @param {string} key */
export function isInvoiceSettingsKey(key) {
	return key === INVOICE_SETTINGS_KEY;
}

/**
 * Who is charging, in the detail a German invoice is expected to carry.
 *
 * §14 Abs. 4 UStG asks for the issuer's full name and address, their VAT id or
 * tax number, and the invoice's own particulars. The rest of the footer — the
 * register entry, the managing director, the bank — is not the UStG's business
 * but §35a GmbHG's and §5 TMG's, and every invoice a business sends carries it
 * anyway, because that is where a customer looks for where to pay.
 *
 * @typedef {{
 *   name: string, address: string, vatId: string, taxNumber: string,
 *   email: string, phone: string, web: string,
 *   bank: { name: string, iban: string, bic: string },
 *   crypto: { btc: string, eth: string },
 *   register: { court: string, number: string, managingDirector: string },
 *   logo: string
 * }} Issuer
 */

/** @param {Partial<Issuer>} [values] @returns {Issuer} */
export function emptyIssuer(values = {}) {
	return {
		name: '',
		address: '',
		vatId: '',
		taxNumber: '',
		email: '',
		phone: '',
		web: '',
		...values,
		bank: { name: '', iban: '', bic: '', ...(values.bank ?? {}) },
		crypto: { btc: '', eth: '', ...(values.crypto ?? {}) },
		register: { court: '', number: '', managingDirector: '', ...(values.register ?? {}) },
		// A PNG as a data URL. It travels with the list, because a logo that
		// lives on one device is missing from every invoice the other one writes.
		logo: values.logo ?? ''
	};
}

/**
 * @param {string} identityId
 * @returns {{
 *   issuer: Issuer,
 *   circles: Record<string, import('./numbering.js').NumberCircle>,
 *   taxMode: import('./records.js').TaxMode,
 *   paymentTermsDays: number,
 *   template: string
 * }}
 */
export function defaultInvoiceSettings(identityId) {
	return {
		issuer: emptyIssuer(),
		// One circle per identity, kept under the identity it belongs to: a
		// second device adds its own and rewrites nobody else's. Before there is
		// an identity — the page is open, the passkey is not — there is nothing
		// to derive a series from, and settings without a series are still
		// settings.
		circles: identityId ? { [identityId]: circleForIdentity(identityId) } : {},
		taxMode: 'standard',
		paymentTermsDays: 14,
		// The wording of the letter, as Markdown. Empty means "whatever this
		// reader's language says by default", which the app fills in.
		template: ''
	};
}

/**
 * Read stored settings back, filling in what is missing.
 *
 * A device that opens a list for the first time finds settings without its own
 * circle in them; it adds one rather than borrowing another device's, which
 * would be the one way to make two devices share a counter.
 *
 * @param {unknown} stored
 * @param {string} identityId
 */
export function normaliseInvoiceSettings(stored, identityId) {
	const defaults = defaultInvoiceSettings(identityId);
	const value = stored && typeof stored === 'object' ? /** @type {any} */ (stored) : {};
	const circles = value.circles && typeof value.circles === 'object' ? { ...value.circles } : {};
	if (identityId && !circles[identityId]?.pattern) {
		circles[identityId] = defaults.circles[identityId];
	}

	return {
		// Nested groups are filled in one by one: settings written before the
		// footer existed carry an issuer without a bank, and reading them must
		// not produce an issuer without a bank either.
		issuer: emptyIssuer(value.issuer ?? {}),
		circles,
		taxMode: value.taxMode ?? defaults.taxMode,
		paymentTermsDays: Number.isInteger(value.paymentTermsDays)
			? value.paymentTermsDays
			: defaults.paymentTermsDays,
		template: typeof value.template === 'string' ? value.template : defaults.template
	};
}

/**
 * The circle this identity issues from.
 *
 * @param {ReturnType<typeof normaliseInvoiceSettings>} settings
 * @param {string} identityId
 */
export function circleOf(settings, identityId) {
	if (settings.circles[identityId]) return settings.circles[identityId];
	return identityId ? circleForIdentity(identityId) : null;
}

/**
 * The number this identity's next invoice gets.
 *
 * `issuedNumbers` is every number in the list, from every device: the circle
 * itself decides which of them are its own, because another identity's numbers
 * do not fit this pattern and are therefore not counted.
 *
 * @param {ReturnType<typeof normaliseInvoiceSettings>} settings
 * @param {string} identityId
 * @param {string[]} issuedNumbers
 * @param {Date} [date]
 */
export function nextNumberFor(settings, identityId, issuedNumbers, date = new Date()) {
	const circle = circleOf(settings, identityId);
	return circle ? nextInvoiceNumber(circle, issuedNumbers, date) : '';
}
