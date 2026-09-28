// What the screens do with invoices, on top of the core (@le-space/invoice)
// and the sealed store. Kept apart from the components so it can be tested
// without a browser.

import {
	cancellationFor,
	emptyDraft,
	invoiceTotals,
	issue,
	upgradeInvoice
} from '@le-space/invoice/records';
import { paidUnits, paymentStatus } from '@le-space/invoice/payments';
import { applyChainTemplate, chainTemplateText } from '@le-space/invoice/chain-templates';
import { nextNumberFor } from '@le-space/invoice/settings';
import { setSetting } from './store/settings.js';

/** @typedef {import('./store/repository.js').Collection} Collection */
/** @typedef {{ invoices: Collection, settings: Collection }} Store */

/**
 * A record for the store: the core's own `inv_…` id is left out, so the store
 * gives it a ULID of its own (store/repository.js).
 *
 * @param {Record<string, any>} draft
 */
function forStore(draft) {
	const rest = { ...draft };
	delete rest.id;
	return rest;
}

/**
 * A new draft, with the settings' tax mode and payment terms, set up for a
 * chain when a template is chosen.
 *
 * @param {Store} store
 * @param {any} settings normalised invoice settings
 * @param {{ templateId?: string | null, language?: 'de' | 'en' }} [options]
 */
export async function createDraft(store, settings, { templateId = null, language = 'de' } = {}) {
	/** @type {any} */
	let draft = {
		...emptyDraft({ taxMode: settings?.taxMode ?? 'standard' }),
		paymentTermsDays: settings?.paymentTermsDays ?? 14
	};
	if (templateId) draft = applyChainTemplate(draft, templateId, { language });
	return store.invoices.put({ ...forStore(draft), chainTemplate: templateId });
}

/**
 * Save a draft as it is. An issued invoice is never rewritten.
 *
 * @param {Store} store
 * @param {any} draft
 */
export async function saveDraft(store, draft) {
	const stored = await store.invoices.get(draft.id);
	if (stored && stored.state !== 'draft') throw new Error('An issued invoice is not rewritten.');
	return store.invoices.put(draft);
}

/**
 * Keep the payments another app reported for an issued invoice (UCEP
 * `record-payment`). The one write an issued invoice takes after issuing, and
 * it writes nothing but `payments`: every other field stays as it was issued.
 * A draft, an Eigenbeleg or an unknown id is refused.
 *
 * @param {{ invoices: Collection }} store
 * @param {string} id
 * @param {(payments: any[]) => any[]} change the payments so far → the payments now
 */
export async function updatePayments(store, id, change) {
	const stored = await store.invoices.get(id);
	if (!stored || stored.deleted || stored.state !== 'issued' || stored.kind === 'eigenbeleg') {
		throw new Error('Payments are kept for issued invoices only.');
	}
	const payments = change(Array.isArray(stored.payments) ? stored.payments : []);
	return store.invoices.put({ id, payments });
}

/**
 * What the screens say about an issued invoice's payment, or null where there
 * is nothing to say: a draft, an Eigenbeleg, a cancelled invoice, a Storno.
 *
 * @param {any} invoice upgraded, with `cancelledBy` folded in (session.svelte.js)
 * @param {string} today YYYY-MM-DD
 * @returns {{ status: 'paid' | 'partially-paid' | 'overdue' | 'open', paidOn: string | null, total: bigint, paid: bigint } | null}
 */
export function paymentOf(invoice, today) {
	if (
		invoice?.state !== 'issued' ||
		invoice.kind === 'eigenbeleg' ||
		invoice.cancelledBy ||
		invoice.cancels
	) {
		return null;
	}
	let total;
	try {
		total = BigInt(invoiceTotals(invoice).due);
	} catch {
		return null;
	}
	if (total <= 0n) return null;
	return { ...paymentStatus(invoice, total, today), total, paid: paidUnits(invoice.payments) };
}

/** Today as YYYY-MM-DD, in the local time zone. */
export function today(date = new Date()) {
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 10);
}

/**
 * Issue a draft: the next number of this passkey's circle, the issuer from the
 * settings, and the wording of its chain template or of the settings — all of
 * it frozen by `issue` (records.js), which refuses a draft with problems.
 *
 * @param {Store} store
 * @param {{ draft: any, settings: any, did: string, invoices: any[], now?: Date, language?: 'de' | 'en' }} params
 */
export async function issueDraft(
	store,
	{ draft, settings, did, invoices, now = new Date(), language = 'de' }
) {
	const numbers = invoices
		.filter((invoice) => invoice.state === 'issued' && invoice.number)
		.map((invoice) => invoice.number);
	const number = nextNumberFor(settings, did, numbers, now);
	const template = draft.chainTemplate
		? chainTemplateText(draft.chainTemplate, language)
		: (settings.template ?? '');
	const issued = issue(upgradeInvoice(draft), {
		number,
		issuer: settings.issuer,
		issuedBy: did,
		issuedAt: now.toISOString(),
		template
	});
	return store.invoices.put(issued);
}

/**
 * The draft of a Storno for an issued invoice (§31 Abs. 5 UStDV), stored and
 * ready to be issued like any other.
 *
 * @param {Store} store
 * @param {any} issued
 */
export async function draftCancellation(store, issued) {
	const draft = cancellationFor(upgradeInvoice(issued));
	return store.invoices.put({ ...forStore(draft), chainTemplate: issued.chainTemplate ?? null });
}

/**
 * @param {Store} store
 * @param {any} settings
 */
export async function saveSettings(store, settings) {
	return setSetting(store.settings, 'invoice', settings);
}
