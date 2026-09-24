/**
 * The customers an invoice is written to.
 *
 * Typing an address into every invoice is not an interface anybody uses twice,
 * so customers are their own records beside the invoices, with the defaults an
 * invoice starts from.
 *
 * **An issued invoice keeps a copy, not a reference.** When a customer moves,
 * last year's invoice must still show where they were when it was issued —
 * which is both the accounting rule and the only thing an append-only log can
 * honour: a reference would rewrite history, a copy cannot. `issue()` takes
 * that snapshot; nothing here is read again once an invoice has gone out.
 *
 * **Sealing is decided, not built.** The directory stays in this list, and the
 * list's own database gets OrbitDB's `encryption` option — `payloadEncryption`
 * in `entry-encryption.js`, the machinery this chapter already carries from
 * `privacy01`. The key comes from the passkey rather than from local storage:
 * the provider exports `extractPrfSeedFromCredential`, so one passkey opens the
 * list on every device it is present on, and a list somebody else holds is
 * blocks they cannot read. `database-keys.js` is the seam that changes; what it
 * calls "Phase 2" is this. Until then the directory is readable by whoever the
 * list is shared with, which is why invoices belong in a list of your own.
 *
 * **What "delete" can and cannot mean.** A customer record is personal data,
 * and Art. 17 GDPR gives a person the right to have it erased. A replicated
 * append-only log cannot forget: marking an entry deleted hides it here and
 * removes nothing from the log, and every replica keeps what it already has.
 * So that is exactly what this offers — and says.
 */

/** Every customer entry is keyed with this, so it is neither a todo nor an invoice. */
export const CUSTOMER_PREFIX = 'customer/';

/** @param {string} key */
export function isCustomerKey(key) {
	return typeof key === 'string' && key.startsWith(CUSTOMER_PREFIX);
}

/** @param {string} id */
export function customerKey(id) {
	return `${CUSTOMER_PREFIX}${id}`;
}

export function newCustomerId() {
	return `cus_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * @typedef {{
 *   id: string,
 *   number: string,
 *   name: string,
 *   address: string,
 *   vatId: string,
 *   taxMode: import('./records.js').TaxMode,
 *   paymentTermsDays: number | null,
 *   note: string,
 *   deletedAt: string | null,
 *   createdAt: string,
 *   updatedAt: string
 * }} Customer
 */

/**
 * @param {Partial<Customer>} [values]
 * @returns {Customer}
 */
export function emptyCustomer(values = {}) {
	const now = new Date().toISOString();
	return {
		id: newCustomerId(),
		// What this customer is called in the books — theirs to choose, not
		// derived: a business migrating from another program brings its own.
		number: '',
		name: '',
		address: '',
		vatId: '',
		taxMode: 'standard',
		// null means "whatever the settings say", so a change there reaches
		// every customer who never asked for something else.
		paymentTermsDays: null,
		note: '',
		deletedAt: null,
		createdAt: now,
		updatedAt: now,
		...values
	};
}

/**
 * What stands in the way of keeping this customer.
 *
 * @param {Partial<Customer>} customer
 * @returns {{ code: string, field: string }[]}
 */
export function customerProblems(customer) {
	/** @type {{ code: string, field: string }[]} */
	const problems = [];
	if (!String(customer?.name ?? '').trim()) {
		problems.push({ code: 'invoice.problem.customerName', field: 'name' });
	}
	if (!String(customer?.address ?? '').trim()) {
		problems.push({ code: 'invoice.problem.customerAddress', field: 'address' });
	}
	return problems;
}

/**
 * The directory as it is offered: what has not been marked deleted, by name.
 *
 * @template {{ name?: string, deletedAt?: string | null }} T
 * @param {T[]} customers
 */
export function activeCustomers(customers) {
	return customers
		.filter((customer) => !customer.deletedAt)
		.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'de'));
}

/**
 * The directory, narrowed to what somebody typed.
 *
 * @template {{ name?: string, address?: string, vatId?: string, number?: string, deletedAt?: string | null }} T
 * @param {T[]} customers
 * @param {string} query
 */
export function matchCustomers(customers, query) {
	const needle = String(query ?? '')
		.trim()
		.toLowerCase();
	const active = activeCustomers(customers);
	if (needle === '') return active;
	return active.filter((customer) =>
		[customer.name, customer.address, customer.vatId, customer.number]
			.map((value) => String(value ?? '').toLowerCase())
			.some((value) => value.includes(needle))
	);
}

/**
 * The customer block of an invoice, as a directory entry would fill it in.
 *
 * @param {Partial<Customer>} customer
 */
export function invoiceCustomerFrom(customer) {
	return {
		number: String(customer?.number ?? ''),
		name: String(customer?.name ?? ''),
		address: String(customer?.address ?? ''),
		vatId: String(customer?.vatId ?? '')
	};
}

/**
 * A directory entry from what somebody typed into an invoice.
 *
 * @param {{ name?: string, address?: string, vatId?: string, number?: string }} block
 * @param {Partial<Customer>} [values] an existing entry to update
 */
export function customerFromInvoice(block, values = {}) {
	return emptyCustomer({
		...values,
		number: String(block?.number ?? values.number ?? '').trim(),
		name: String(block?.name ?? '').trim(),
		address: String(block?.address ?? '').trim(),
		vatId: String(block?.vatId ?? '').trim(),
		updatedAt: new Date().toISOString()
	});
}

/**
 * Mark an entry deleted — which hides it here and removes nothing from the log.
 *
 * @param {Customer} customer
 */
export function markDeleted(customer) {
	return { ...customer, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
