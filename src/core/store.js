/**
 * The invoice stores, on their own so that both the reader (`db-actions.js`,
 * which folds the log into them) and the writer (`invoice-actions.js`) can
 * import them without importing each other.
 */

import { derived, writable } from 'svelte/store';

/** @type {import('svelte/store').Writable<any[]>} */
export const invoicesStore = writable([]);

/** The customer directory of the open list. */
export const customersStore = writable(/** @type {any[]} */ ([]));

/** Raw settings as they sit in the list; null until a list is open. */
export const invoiceSettingsStore = writable(/** @type {any} */ (null));

export const invoiceCountStore = derived(invoicesStore, ($invoices) => $invoices.length);

/** The numbers already handed out — what the next one is derived from. */
export const issuedNumbersStore = derived(invoicesStore, ($invoices) =>
	$invoices.filter((invoice) => invoice.state === 'issued' && invoice.number).map((i) => i.number)
);
