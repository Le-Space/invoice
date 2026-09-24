/**
 * The invoice record, and the one act that freezes it.
 *
 * An invoice has two lives. As a *draft* it is an ordinary entry that may be
 * rewritten as often as anyone likes. *Issuing* is the act that gives it its
 * number, copies in everything it must still show years later, and ends the
 * rewriting: §14 Abs. 4 UStG lists what has to be on the document, and
 * §31 Abs. 5 UStDV says a wrong invoice is corrected — not edited. Whoever
 * states VAT owes it under §14c UStG until a correction exists.
 *
 * That matches the log this runs on, which is the reason the shape is worth
 * getting right here rather than in the user interface: a replicated
 * append-only log cannot take an entry back, so an issued invoice is never
 * rewritten. A *Storno* is its own invoice, with the amounts negated and a
 * reference to the one it cancels, and `foldCancellations` puts the two back
 * together for the reader.
 *
 * What is copied rather than referenced — the issuer's and the customer's
 * address, and the totals — is copied on purpose. When a customer moves, last
 * year's invoice must still show where they were when it was issued.
 */

import { computeTotals } from './money.js';

/** Every invoice entry is keyed with this, so it is not read as a todo. */
export const INVOICE_PREFIX = 'invoice/';

/** @typedef {'standard' | 'kleinunternehmer' | 'reverse-charge'} TaxMode */
/** @typedef {{ name: string, address: string, vatId?: string, email?: string, iban?: string }} Party */
/**
 * A line as it is charged, and as it is explained.
 *
 * `description` is what the line is; `subtitle` is the one-line context under
 * it ("Doichain Core 31.1 · Aufwand 9,5 Std."), and `details` are the bullets
 * that say what was actually done. Both are optional and neither affects a
 * figure — they exist because an invoice a customer can check is an invoice
 * that gets paid.
 *
 * @typedef {{
 *   description: string,
 *   subtitle?: string,
 *   details?: string[],
 *   quantity: number,
 *   unit: string,
 *   unitPriceCents: number,
 *   vatRate: number
 * }} InvoiceLine
 */
/** @typedef {{ code: string, field: string, line?: number }} Problem */

/** @param {string} key */
export function isInvoiceKey(key) {
	return typeof key === 'string' && key.startsWith(INVOICE_PREFIX);
}

/** @param {string} id */
export function invoiceKey(id) {
	return `${INVOICE_PREFIX}${id}`;
}

/** A key nobody else writes, in the shape the todos already use. */
export function newInvoiceId() {
	return `inv_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** @param {Date} [date] */
function isoDay(date = new Date()) {
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 10);
}

/**
 * A line with nothing in it yet.
 *
 * @param {Partial<InvoiceLine>} [values]
 * @returns {InvoiceLine}
 */
export function emptyLine(values = {}) {
	return {
		description: '',
		subtitle: '',
		details: [],
		quantity: 1,
		unit: 'Stück',
		unitPriceCents: 0,
		vatRate: 19,
		...values
	};
}

/**
 * A draft, ready to be filled in.
 *
 * @param {{ taxMode?: TaxMode, customer?: Partial<Party>, issueDate?: string }} [values]
 */
export function emptyDraft({ taxMode = 'standard', customer, issueDate } = {}) {
	const day = issueDate ?? isoDay();
	return {
		id: newInvoiceId(),
		state: /** @type {'draft'} */ ('draft'),
		taxMode,
		customer: { name: '', address: '', vatId: '', ...customer },
		lines: [emptyLine()],
		issueDate: day,
		/** §14 Abs. 4 Nr. 6 UStG: the invoice says when it was delivered, not only when it was written. */
		deliveryDate: day,
		paymentTermsDays: 14,
		notes: '',
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	};
}

/**
 * The note an invoice must carry because of its tax mode, or null.
 *
 * @param {TaxMode} taxMode
 */
export function requiredNoteCode(taxMode) {
	if (taxMode === 'kleinunternehmer') return 'invoice.note.kleinunternehmer';
	if (taxMode === 'reverse-charge') return 'invoice.note.reverseCharge';
	return null;
}

/**
 * What still stands in the way of issuing this draft.
 *
 * Codes, not sentences: the texts live in the catalogues, where a missing
 * translation is caught by `catalogue.spec.js`.
 *
 * @param {ReturnType<typeof emptyDraft>} draft
 * @param {{ issuer?: Partial<Party> }} [context]
 * @returns {Problem[]}
 */
export function draftProblems(draft, { issuer } = {}) {
	/** @type {Problem[]} */
	const problems = [];
	const text = (/** @type {unknown} */ value) => (typeof value === 'string' ? value.trim() : '');

	if (!text(issuer?.name) || !text(issuer?.address)) {
		problems.push({ code: 'invoice.problem.issuerMissing', field: 'issuer' });
	}
	if (!text(draft.customer?.name)) {
		problems.push({ code: 'invoice.problem.customerName', field: 'customer.name' });
	}
	if (!text(draft.customer?.address)) {
		problems.push({ code: 'invoice.problem.customerAddress', field: 'customer.address' });
	}
	// §13b UStG only works towards a business that names its VAT id.
	if (draft.taxMode === 'reverse-charge' && !text(draft.customer?.vatId)) {
		problems.push({ code: 'invoice.problem.customerVatId', field: 'customer.vatId' });
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text(draft.issueDate))) {
		problems.push({ code: 'invoice.problem.issueDate', field: 'issueDate' });
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text(draft.deliveryDate))) {
		problems.push({ code: 'invoice.problem.deliveryDate', field: 'deliveryDate' });
	}

	const lines = Array.isArray(draft.lines) ? draft.lines : [];
	if (lines.length === 0) {
		problems.push({ code: 'invoice.problem.noLines', field: 'lines' });
	}
	lines.forEach((line, index) => {
		if (!text(line?.description)) {
			problems.push({ code: 'invoice.problem.lineDescription', field: 'description', line: index });
		}
		if (!Number.isFinite(line?.quantity) || line.quantity === 0) {
			problems.push({ code: 'invoice.problem.lineQuantity', field: 'quantity', line: index });
		}
		if (!Number.isInteger(line?.unitPriceCents)) {
			problems.push({
				code: 'invoice.problem.lineUnitPrice',
				field: 'unitPriceCents',
				line: index
			});
		}
		if (draft.taxMode === 'standard' && ![0, 7, 19].includes(line?.vatRate)) {
			problems.push({ code: 'invoice.problem.lineVatRate', field: 'vatRate', line: index });
		}
	});

	return problems;
}

/**
 * The totals of an invoice, computed — never read back from the record.
 *
 * On an issued invoice the stored copy is a witness: it and this result must
 * agree, and `totalsDisagree` is how a reader finds out that they do not.
 *
 * @param {{ lines: InvoiceLine[], taxMode: TaxMode }} invoice
 */
export function invoiceTotals(invoice) {
	return computeTotals(invoice.lines ?? [], invoice.taxMode ?? 'standard');
}

/**
 * Turn a draft into an issued invoice: the number is assigned, the addresses
 * and totals are frozen, and nothing about it is rewritten afterwards.
 *
 * @param {ReturnType<typeof emptyDraft>} draft
 * @param {{ number: string, issuer: Party, issuedBy: string, issuedAt?: string, template?: string }} act
 */
export function issue(
	draft,
	{ number, issuer, issuedBy, issuedAt = new Date().toISOString(), template = '' }
) {
	const problems = draftProblems(draft, { issuer });
	if (problems.length > 0) {
		throw new Error(`This invoice is not ready to be issued: ${problems[0].code}`);
	}
	if (!number || typeof number !== 'string') {
		throw new Error('An issued invoice needs its number.');
	}

	const { netTotalCents, taxTotalCents, grossTotalCents, vatBreakdown } = invoiceTotals(draft);
	return {
		...draft,
		state: /** @type {'issued'} */ ('issued'),
		number,
		issuedAt,
		issuedBy,
		issuer: { ...issuer },
		customer: { ...draft.customer },
		// The wording is frozen with everything else: a template edited next
		// year must not change what last year's invoice said.
		template,
		lines: draft.lines.map((line) => ({ ...line, details: [...(line.details ?? [])] })),
		noteCode: requiredNoteCode(draft.taxMode),
		totals: { netTotalCents, taxTotalCents, grossTotalCents, vatBreakdown },
		updatedAt: issuedAt
	};
}

/**
 * Whether an issued invoice still adds up to what it says it does.
 *
 * @param {ReturnType<typeof issue>} invoice
 */
export function totalsDisagree(invoice) {
	if (!invoice?.totals) return false;
	const computed = invoiceTotals(invoice);
	return (
		computed.netTotalCents !== invoice.totals.netTotalCents ||
		computed.taxTotalCents !== invoice.totals.taxTotalCents ||
		computed.grossTotalCents !== invoice.totals.grossTotalCents
	);
}

/**
 * The draft that cancels an issued invoice (§31 Abs. 5 UStDV).
 *
 * Same lines, negated quantities, and a reference to the number it takes back.
 * It is issued like any other invoice and gets the next number of the series —
 * the original is left exactly as it was, because in an append-only log that is
 * the only honest way to correct it.
 *
 * @param {ReturnType<typeof issue>} issued
 * @param {{ issueDate?: string }} [options]
 */
export function cancellationFor(issued, { issueDate = isoDay() } = {}) {
	if (issued?.state !== 'issued' || !issued.number) {
		throw new Error('Only an issued invoice can be cancelled.');
	}

	return {
		...emptyDraft({ taxMode: issued.taxMode, customer: issued.customer, issueDate }),
		deliveryDate: issued.deliveryDate,
		paymentTermsDays: issued.paymentTermsDays,
		cancels: issued.number,
		lines: issued.lines.map((line) => ({ ...line, quantity: -line.quantity }))
	};
}

/**
 * Mark the invoices that a Storno has taken back.
 *
 * The log carries both entries and says nothing about their relationship; this
 * is where the reader gets it back, the same way delegation actions are folded
 * into the todo they name.
 *
 * @template {{ number?: string, cancels?: string }} T
 * @param {T[]} invoices
 * @returns {(T & { cancelledBy?: string })[]}
 */
export function foldCancellations(invoices) {
	/** @type {Map<string, string>} */
	const cancelled = new Map();
	for (const invoice of invoices) {
		if (invoice.cancels && invoice.number) cancelled.set(invoice.cancels, invoice.number);
	}
	return invoices.map((invoice) =>
		invoice.number && cancelled.has(invoice.number)
			? { ...invoice, cancelledBy: cancelled.get(invoice.number) }
			: invoice
	);
}
