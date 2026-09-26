// What the screens do with invoices, on top of the core (@le-space/invoice)
// and the sealed store. Kept apart from the components so it can be tested
// without a browser.

import { cancellationFor, emptyDraft, issue, upgradeInvoice } from '@le-space/invoice/records';
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
