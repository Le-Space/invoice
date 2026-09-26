<script>
	import { goto } from '$app/navigation';
	import { CHAIN_TEMPLATES } from '@le-space/invoice/chain-templates';
	import { invoiceTotals, moneyUnit } from '@le-space/invoice/records';
	import { formatMoney } from '@le-space/invoice/money';
	import { formatDay } from '@le-space/invoice/document';
	import { isEigenbeleg } from '@le-space/invoice/eigenbeleg';
	import { t } from '$lib/i18n/index.js';
	import { app, currentStore } from '$lib/session.svelte.js';
	import { createDraft } from '$lib/invoices.js';

	let templateId = $state('');
	let busy = $state(false);

	/** @param {any} invoice */
	function stateLabel(invoice) {
		if (isEigenbeleg(invoice)) return t('invoice.app.list.eigenbeleg');
		if (invoice.cancelledBy) return t('invoice.app.list.cancelled');
		return invoice.state === 'issued' ? t('invoice.app.list.issued') : t('invoice.app.list.draft');
	}

	/** @param {any} invoice */
	function due(invoice) {
		if (isEigenbeleg(invoice)) {
			const { units, currency, decimals } = invoice.amount;
			return formatMoney(units, { code: currency, decimals });
		}
		try {
			return formatMoney(invoiceTotals(invoice).due, moneyUnit(invoice));
		} catch {
			return '—';
		}
	}

	async function newInvoice() {
		const store = currentStore();
		if (!store || busy) return;
		busy = true;
		try {
			const draft = await createDraft(store, app.settings, { templateId: templateId || null });
			await goto(`/rechnung/${draft.id}`);
		} finally {
			busy = false;
		}
	}
</script>

<section data-testid="invoice-list">
	<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
		<h1 class="text-lg font-semibold text-heading">{t('invoice.app.list.heading')}</h1>
		<div class="flex flex-wrap items-end gap-2">
			<label class="text-sm text-text">
				<span class="block text-xs text-faint">{t('invoice.app.list.fromTemplate')}</span>
				<select
					bind:value={templateId}
					class="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
					data-testid="new-template"
				>
					<option value="">{t('invoice.app.list.noTemplate')}</option>
					{#each CHAIN_TEMPLATES as template (template.id)}
						<option value={template.id}>{template.name.de}</option>
					{/each}
				</select>
			</label>
			<button
				type="button"
				class="rounded-md bg-coral-700 px-4 py-2 text-sm font-medium text-white hover:bg-coral-800 disabled:opacity-50"
				disabled={busy}
				onclick={newInvoice}
				data-testid="new-invoice">{t('invoice.app.list.new')}</button
			>
		</div>
	</div>

	{#if app.invoices.length === 0}
		<p class="rounded-lg border border-border bg-surface p-6 text-sm text-text" data-testid="empty">
			{t('invoice.app.list.empty')}
		</p>
	{:else}
		<div class="overflow-x-auto rounded-lg border border-border bg-surface">
			<table class="w-full text-sm">
				<thead class="text-left text-xs text-faint">
					<tr class="border-b border-border">
						<th class="px-3 py-2 font-medium">{t('invoice.app.list.state')}</th>
						<th class="px-3 py-2 font-medium">{t('invoice.app.list.customer')}</th>
						<th class="px-3 py-2 font-medium">{t('invoice.app.list.date')}</th>
						<th class="px-3 py-2 text-right font-medium">{t('invoice.app.list.amount')}</th>
					</tr>
				</thead>
				<tbody>
					{#each app.invoices as invoice (invoice.id)}
						<tr
							class="border-b border-border last:border-0 hover:bg-surface-2"
							data-testid="invoice-row"
						>
							<td class="px-3 py-2">
								<a class="font-medium text-link hover:underline" href={`/rechnung/${invoice.id}`}
									>{invoice.number || stateLabel(invoice)}</a
								>
								{#if invoice.number}
									<span class="ml-1 text-xs text-faint">{stateLabel(invoice)}</span>
								{/if}
							</td>
							<td class="px-3 py-2 text-text"
								>{(isEigenbeleg(invoice)
									? invoice.counterparty?.name || invoice.requestedBy?.label
									: invoice.customer?.name) || '—'}</td
							>
							<td class="px-3 py-2 text-text"
								>{formatDay(isEigenbeleg(invoice) ? invoice.date : invoice.issueDate)}</td
							>
							<td class="px-3 py-2 text-right font-mono text-heading">{due(invoice)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
