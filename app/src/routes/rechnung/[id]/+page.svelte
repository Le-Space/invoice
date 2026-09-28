<script>
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { INVOICE_CURRENCIES } from '@le-space/invoice/currency';
	import { CURRENCY_NETWORKS, NETWORKS } from '@le-space/invoice/networks';
	import {
		draftProblems,
		draftWarnings,
		emptyLine,
		invoiceTotals,
		moneyUnit,
		setCurrency,
		upgradeInvoice
	} from '@le-space/invoice/records';
	import { formatAmount, formatMoney, parseAmount, parseQuantity } from '@le-space/invoice/money';
	import { formatDay } from '@le-space/invoice/document';
	import { RATE_SOURCES, cryptoLine, cryptoSubtotals } from '@le-space/invoice/crypto-lines';
	import { documentLabels } from '@le-space/invoice/labels';
	import { invoiceFileName, invoicePdfBytes } from '@le-space/invoice/pdf';
	import { isEigenbeleg } from '@le-space/invoice/eigenbeleg';
	import {
		eigenbelegFileName,
		eigenbelegLabels,
		eigenbelegPdfBytes,
		eigenbelegRows
	} from '@le-space/invoice/eigenbeleg-pdf';
	import { t } from '$lib/i18n/index.js';
	import { app, currentStore } from '$lib/session.svelte.js';
	import { draftCancellation, issueDraft, paymentOf, saveDraft, today } from '$lib/invoices.js';
	import { dueOn } from '@le-space/invoice/payments';
	import PaymentBadge from '$lib/PaymentBadge.svelte';

	let id = $derived(page.params.id);
	let stored = $derived(app.invoices.find((invoice) => invoice.id === id) ?? null);

	/** The draft being edited; a copy, written back on "Speichern". @type {any} */
	let draft = $state(null);
	/** What was typed into each price field, so a half-typed price stays as typed. @type {string[]} */
	let priceText = $state([]);
	let saved = $state(false);
	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	// A new invoice (another id) starts a new copy; a refresh of the same one
	// while editing does not throw away what was typed.
	let loadedId = '';
	$effect(() => {
		if (stored && stored.id !== loadedId) {
			loadedId = stored.id;
			draft = structuredClone($state.snapshot(stored));
			ensureRate();
			priceText = (draft.lines ?? []).map((/** @type {any} */ line) =>
				formatAmount(line.unitPrice, moneyUnit(draft))
			);
		}
	});

	let unit = $derived(draft ? moneyUnit(draft) : { code: 'EUR', decimals: 2 });
	let eigenbeleg = $derived(isEigenbeleg(stored));
	let issued = $derived(stored?.state === 'issued' || eigenbeleg);
	let problems = $derived(
		draft && !issued ? draftProblems(draft, { issuer: app.settings?.issuer }) : []
	);
	let warnings = $derived(draft && !issued ? draftWarnings(draft) : []);
	let totals = $derived.by(() => {
		try {
			return draft ? invoiceTotals(draft) : null;
		} catch {
			return null;
		}
	});
	let networks = $derived(draft ? (CURRENCY_NETWORKS[draft.currency] ?? []) : []);
	let payment = $derived(issued && !eigenbeleg ? paymentOf(stored, today()) : null);
	/** The payments another app reported, as stored (they change while the invoice does not). */
	let payments = $derived(/** @type {any[]} */ (stored?.payments ?? []));

	/** An invoice not in euros asks for the rate its VAT is converted at. */
	function ensureRate() {
		if (draft && draft.currency !== 'EUR' && !draft.eurRate) {
			draft.eurRate = { eurPerUnit: '', source: '', date: draft.deliveryDate };
		}
	}

	/** @param {string} code */
	function changeCurrency(code) {
		draft = setCurrency(draft, code);
		priceText = draft.lines.map((/** @type {any} */ line) =>
			formatAmount(line.unitPrice, moneyUnit(draft))
		);
		ensureRate();
	}

	/** @param {number} index @param {string} text */
	function changePrice(index, text) {
		priceText[index] = text;
		const units = parseAmount(text, unit);
		if (units !== null) draft.lines[index].unitPrice = units;
	}

	/** @param {number} index @param {string} text */
	function changeQuantity(index, text) {
		const quantity = parseQuantity(text);
		if (quantity !== null) draft.lines[index].quantity = quantity;
	}

	function addLine() {
		draft.lines.push(emptyLine());
		priceText.push(formatAmount('0', unit));
	}

	const cryptoLabels = {
		subtitle: t('invoice.cryptoLine.subtitle'),
		transaction: t('invoice.cryptoLine.transaction')
	};

	/** A line of crypto: asset, quantity and rate typed in, the price in euros computed. */
	function addCryptoLine() {
		draft.lines.push({
			...emptyLine(),
			crypto: {
				asset: '',
				quantity: '',
				rate: '',
				rateSource: 'coingecko',
				rateAt: draft.deliveryDate || today(),
				hash: ''
			}
		});
		priceText.push(formatAmount('0', unit));
	}

	/** Price a crypto line again from what was typed. @param {number} index */
	function changeCrypto(index) {
		const line = draft.lines[index];
		const result = cryptoLine(line.crypto, unit, {
			description: line.description,
			vatRate: line.vatRate,
			unit: line.unit,
			labels: cryptoLabels
		});
		if ('line' in result) {
			Object.assign(line, {
				quantity: 1,
				unitPrice: result.line.unitPrice,
				subtitle: result.line.subtitle,
				details: result.line.details,
				source: result.line.source
			});
		} else {
			// Not a line yet: no price, and the draft says what is missing.
			Object.assign(line, { unitPrice: '0', subtitle: '', details: [] });
			delete line.source;
		}
		priceText[index] = formatAmount(line.unitPrice, unit);
	}

	/** @param {number} index */
	function removeLine(index) {
		draft.lines.splice(index, 1);
		priceText.splice(index, 1);
	}

	async function save() {
		const store = currentStore();
		if (!store) return;
		busy = true;
		error = null;
		try {
			await saveDraft(store, $state.snapshot(draft));
			saved = true;
			setTimeout(() => (saved = false), 1500);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function issueNow() {
		const store = currentStore();
		if (!store || !app.did || !confirm(t('invoice.app.editor.issueConfirm'))) return;
		busy = true;
		error = null;
		try {
			const snapshot = $state.snapshot(draft);
			await saveDraft(store, snapshot);
			await issueDraft(store, {
				draft: snapshot,
				settings: app.settings,
				did: app.did,
				invoices: app.invoices
			});
			loadedId = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function downloadPdf() {
		busy = true;
		try {
			const record = $state.snapshot(stored);
			const bytes = eigenbeleg
				? await eigenbelegPdfBytes(
						record,
						eigenbelegLabels((key) => t(key))
					)
				: await invoicePdfBytes(
						upgradeInvoice(record),
						documentLabels((key) => t(key))
					);
			const url = URL.createObjectURL(
				new Blob([/** @type {BlobPart} */ (bytes)], { type: 'application/pdf' })
			);
			const a = document.createElement('a');
			a.href = url;
			a.download = eigenbeleg ? eigenbelegFileName(stored) : invoiceFileName(stored);
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		} finally {
			busy = false;
		}
	}

	async function cancelInvoice() {
		const store = currentStore();
		if (!store) return;
		const storno = await draftCancellation(store, $state.snapshot(stored));
		await goto(`/rechnung/${storno.id}`);
	}

	const input = 'w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm';
	const label = 'block text-xs text-faint';
	const primary =
		'rounded-md bg-coral-700 px-4 py-2 text-sm font-medium text-white hover:bg-coral-800 disabled:opacity-50';
	const secondary =
		'rounded-md border border-border bg-surface px-4 py-2 text-sm text-heading hover:bg-surface-2 disabled:opacity-50';
</script>

<a href="/" class="text-sm text-link hover:underline">{t('invoice.app.editor.back')}</a>

{#if !draft}
	<p class="mt-4 text-sm text-faint">…</p>
{:else if eigenbeleg}
	<section class="mt-4 space-y-4" data-testid="eigenbeleg">
		<h1 class="text-lg font-semibold text-heading">
			{t('invoice.eigenbeleg.doc.title')}
			{stored.number}
		</h1>
		<dl
			class="grid gap-2 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-[12rem_1fr]"
		>
			{#each eigenbelegRows( stored, eigenbelegLabels((key) => t(key)) ) as [label, value] (label)}
				<dt class="text-xs text-faint">{label}</dt>
				<dd class="break-all">{value}</dd>
			{/each}
		</dl>
		<button
			type="button"
			class={primary}
			disabled={busy}
			onclick={downloadPdf}
			data-testid="download-pdf">{t('invoice.app.editor.pdf')}</button
		>
	</section>
{:else if issued}
	<section class="mt-4 space-y-4" data-testid="issued-invoice">
		<h1 class="text-lg font-semibold text-heading">
			{t('invoice.app.editor.issuedHeading', { number: stored.number })}
			<PaymentBadge invoice={stored} />
		</h1>
		{#if stored.cancelledBy}
			<p class="text-sm text-danger" data-testid="cancelled-by">
				{t('invoice.app.editor.cancelled', { number: stored.cancelledBy })}
			</p>
		{/if}
		<dl
			class="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-4"
		>
			<div>
				<dt class={label}>{t('invoice.app.list.customer')}</dt>
				<dd>{stored.customer?.name}</dd>
			</div>
			<div>
				<dt class={label}>{t('invoice.app.list.date')}</dt>
				<dd>{formatDay(stored.issueDate)}</dd>
			</div>
			<div>
				<dt class={label}>{t('invoice.app.editor.currency')}</dt>
				<dd>{stored.currency}{stored.network ? ` · ${NETWORKS[stored.network]?.name}` : ''}</dd>
			</div>
			<div>
				<dt class={label}>{t('invoice.app.editor.due')}</dt>
				<dd class="font-mono font-semibold" data-testid="issued-due">
					{totals ? formatMoney(totals.due, unit) : '—'}
				</dd>
			</div>
			{#if payment}
				<div>
					<dt class={label}>{t('invoice.app.editor.dueOn')}</dt>
					<dd>{formatDay(dueOn(stored)) || '—'}</dd>
				</div>
				<div>
					<dt class={label}>{t('invoice.app.editor.paidSum')}</dt>
					<dd class="font-mono" data-testid="paid-sum">{formatMoney(payment.paid, unit)}</dd>
				</div>
				<div>
					<dt class={label}>{t('invoice.app.editor.openSum')}</dt>
					<dd class="font-mono" data-testid="open-sum">
						{formatMoney(payment.total > payment.paid ? payment.total - payment.paid : 0n, unit)}
					</dd>
				</div>
			{/if}
		</dl>
		{#if payments.length > 0}
			<div class="rounded-lg border border-border bg-surface p-4 text-sm" data-testid="payments">
				<h2 class="text-sm font-medium text-heading">{t('invoice.app.editor.paymentsHeading')}</h2>
				<ul class="mt-2 divide-y divide-border">
					{#each payments as p (`${p.reference?.system}/${p.reference?.id}`)}
						<li
							class="flex flex-wrap items-baseline justify-between gap-2 py-1.5"
							data-testid="payment"
						>
							<span class="text-heading"
								>{t('invoice.app.editor.paymentLine', {
									amount: formatMoney(p.units, unit),
									date: formatDay(p.paidOn)
								})}</span
							>
							{#if p.recordedAt}
								<span class="text-xs text-faint"
									>{t('invoice.app.editor.reportedBy', {
										app: p.recordedBy?.label || t('ucep.pairing.unnamed'),
										date: new Date(p.recordedAt).toLocaleDateString('de-DE')
									})}</span
								>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		<div class="flex flex-wrap gap-2">
			<button
				type="button"
				class={primary}
				disabled={busy}
				onclick={downloadPdf}
				data-testid="download-pdf">{t('invoice.app.editor.pdf')}</button
			>
			{#if !stored.cancelledBy && !stored.cancels}
				<button
					type="button"
					class={secondary}
					disabled={busy}
					onclick={cancelInvoice}
					data-testid="cancel-invoice">{t('invoice.app.editor.cancel')}</button
				>
			{/if}
		</div>
	</section>
{:else}
	<section class="mt-4 space-y-5" data-testid="draft-editor">
		<h1 class="text-lg font-semibold text-heading">{t('invoice.app.editor.draftHeading')}</h1>

		<fieldset class="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
			<legend class="px-1 text-sm font-medium text-heading">{t('invoice.form.customer')}</legend>
			<label class="text-sm"
				><span class={label}>{t('invoice.form.customerName')}</span>
				<input class={input} bind:value={draft.customer.name} data-testid="customer-name" /></label
			>
			<label class="text-sm"
				><span class={label}>{t('invoice.form.customerVatId')}</span>
				<input
					class={input}
					bind:value={draft.customer.vatId}
					data-testid="customer-vat-id"
				/></label
			>
			<label class="text-sm sm:col-span-2"
				><span class={label}>{t('invoice.form.customerAddress')}</span>
				<textarea
					class={input}
					rows="3"
					bind:value={draft.customer.address}
					data-testid="customer-address"
				></textarea></label
			>
		</fieldset>

		<fieldset class="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3">
			<label class="text-sm"
				><span class={label}>{t('invoice.form.issueDate')}</span>
				<input type="date" class={input} bind:value={draft.issueDate} /></label
			>
			<label class="text-sm"
				><span class={label}>{t('invoice.form.deliveryDate')}</span>
				<input
					type="date"
					class={input}
					bind:value={draft.deliveryDate}
					data-testid="delivery-date"
				/></label
			>
			<label class="text-sm"
				><span class={label}>{t('invoice.form.paymentTerms')}</span>
				<input type="number" min="0" class={input} bind:value={draft.paymentTermsDays} /></label
			>
			<label class="text-sm"
				><span class={label}>{t('invoice.form.taxMode')}</span>
				<select class={input} bind:value={draft.taxMode} data-testid="tax-mode">
					{#each ['standard', 'kleinunternehmer', 'reverse-charge'] as mode (mode)}
						<option value={mode}>{t(`invoice.app.taxModes.${mode}`)}</option>
					{/each}
				</select></label
			>
			<label class="text-sm"
				><span class={label}>{t('invoice.app.editor.currency')}</span>
				<select
					class={input}
					value={draft.currency}
					onchange={(e) => changeCurrency(e.currentTarget.value)}
					data-testid="currency"
				>
					<!-- An older draft in a retired currency still shows it, and is flagged. -->
					{#each INVOICE_CURRENCIES.includes(draft.currency) ? INVOICE_CURRENCIES : [...INVOICE_CURRENCIES, draft.currency] as code (code)}
						<option value={code}>{code}</option>
					{/each}
				</select></label
			>
			{#if networks.length > 0}
				<label class="text-sm"
					><span class={label}>{t('invoice.app.editor.network')}</span>
					<select class={input} bind:value={draft.network} data-testid="network">
						{#each networks as net (net)}
							<option value={net}>{NETWORKS[net].name}</option>
						{/each}
					</select></label
				>
			{/if}
		</fieldset>

		{#if draft.currency !== 'EUR' && draft.eurRate}
			<fieldset
				class="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3"
				data-testid="eur-rate"
			>
				<legend class="px-1 text-sm font-medium text-heading"
					>{t('invoice.app.editor.rateHeading')}</legend
				>
				<p class="text-xs text-faint sm:col-span-3">{t('invoice.app.editor.rateHint')}</p>
				<label class="text-sm"
					><span class={label}
						>{t('invoice.app.editor.ratePerUnit', { currency: draft.currency })}</span
					>
					<input
						class={input}
						bind:value={draft.eurRate.eurPerUnit}
						inputmode="decimal"
						data-testid="rate-per-unit"
					/></label
				>
				<label class="text-sm"
					><span class={label}>{t('invoice.app.editor.rateSource')}</span>
					<input class={input} bind:value={draft.eurRate.source} data-testid="rate-source" /></label
				>
				<label class="text-sm"
					><span class={label}>{t('invoice.app.editor.rateDate')}</span>
					<input
						type="date"
						class={input}
						bind:value={draft.eurRate.date}
						data-testid="rate-date"
					/></label
				>
			</fieldset>
		{/if}

		<fieldset class="space-y-3 rounded-lg border border-border bg-surface p-4">
			<legend class="px-1 text-sm font-medium text-heading">{t('invoice.form.lines')}</legend>
			{#each draft.lines as line, index (index)}
				<div
					class="grid gap-2 border-b border-border pb-3 last:border-0 sm:grid-cols-[1fr_5rem_6rem_8rem_5rem_auto]"
					data-testid="line"
				>
					<label class="text-sm"
						><span class={label}>{t('invoice.form.lineDescription')}</span>
						<input
							class={input}
							bind:value={line.description}
							data-testid="line-description"
						/></label
					>
					<label class="text-sm"
						><span class={label}>{t('invoice.form.lineQuantity')}</span>
						<input
							class={input}
							disabled={Boolean(line.crypto)}
							value={String(line.quantity).replace('.', ',')}
							oninput={(e) => changeQuantity(index, e.currentTarget.value)}
							inputmode="decimal"
							data-testid="line-quantity"
						/></label
					>
					<label class="text-sm"
						><span class={label}>{t('invoice.form.lineUnit')}</span>
						<input class={input} bind:value={line.unit} /></label
					>
					<label class="text-sm"
						><span class={label}
							>{t('invoice.app.editor.linePrice', { currency: draft.currency })}</span
						>
						<input
							class="{input} {parseAmount(priceText[index] ?? '', unit) === null
								? 'border-danger'
								: ''}"
							value={priceText[index]}
							readonly={Boolean(line.crypto)}
							oninput={(e) => changePrice(index, e.currentTarget.value)}
							inputmode="decimal"
							data-testid="line-price"
						/></label
					>
					{#if draft.taxMode === 'standard'}
						<label class="text-sm"
							><span class={label}>{t('invoice.form.lineVatRate')}</span>
							<select class={input} bind:value={line.vatRate}>
								{#each [19, 7, 0] as rate (rate)}<option value={rate}>{rate} %</option>{/each}
							</select></label
						>
					{:else}
						<span></span>
					{/if}
					<button
						type="button"
						class="self-end text-sm text-faint hover:text-danger"
						onclick={() => removeLine(index)}
						aria-label={t('invoice.form.removeLine')}>✕</button
					>
					{#if line.crypto}
						<div
							class="grid gap-2 sm:col-span-full sm:grid-cols-[6rem_8rem_8rem_10rem_10rem_1fr]"
							data-testid="crypto-line"
						>
							<label class="text-sm"
								><span class={label}>{t('invoice.app.editor.cryptoAsset')}</span>
								<input
									class={input}
									bind:value={line.crypto.asset}
									oninput={() => changeCrypto(index)}
									placeholder="NYM"
									data-testid="crypto-asset"
								/></label
							>
							<label class="text-sm"
								><span class={label}>{t('invoice.app.editor.cryptoQuantity')}</span>
								<input
									class={input}
									bind:value={line.crypto.quantity}
									oninput={() => changeCrypto(index)}
									inputmode="decimal"
									data-testid="crypto-quantity"
								/></label
							>
							<label class="text-sm"
								><span class={label}>{t('invoice.app.editor.cryptoRate')}</span>
								<input
									class={input}
									bind:value={line.crypto.rate}
									oninput={() => changeCrypto(index)}
									inputmode="decimal"
									data-testid="crypto-rate"
								/></label
							>
							<label class="text-sm"
								><span class={label}>{t('invoice.app.editor.rateSource')}</span>
								<select
									class={input}
									bind:value={line.crypto.rateSource}
									onchange={() => changeCrypto(index)}
									data-testid="crypto-rate-source"
								>
									{#each Object.entries(RATE_SOURCES) as [code, name] (code)}
										<option value={code}>{name}</option>
									{/each}
								</select></label
							>
							<label class="text-sm"
								><span class={label}>{t('invoice.app.editor.rateDate')}</span>
								<input
									type="date"
									class={input}
									bind:value={line.crypto.rateAt}
									onchange={() => changeCrypto(index)}
									data-testid="crypto-rate-date"
								/></label
							>
							<label class="text-sm"
								><span class={label}>{t('invoice.app.editor.cryptoHash')}</span>
								<input
									class="{input} font-mono text-xs"
									bind:value={line.crypto.hash}
									oninput={() => changeCrypto(index)}
									spellcheck="false"
									data-testid="crypto-hash"
								/></label
							>
							{#if line.subtitle}
								<p class="text-xs text-faint sm:col-span-full" data-testid="crypto-subtitle">
									{line.subtitle}
								</p>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
			<div class="flex flex-wrap gap-2">
				<button type="button" class={secondary} onclick={addLine} data-testid="add-line"
					>{t('invoice.form.addLine')}</button
				>
				{#if draft.currency === 'EUR'}
					<button
						type="button"
						class={secondary}
						onclick={addCryptoLine}
						data-testid="add-crypto-line">{t('invoice.app.editor.addCryptoLine')}</button
					>
				{/if}
			</div>
		</fieldset>

		<label class="block text-sm"
			><span class={label}>{t('invoice.form.notes')}</span>
			<textarea class={input} rows="2" bind:value={draft.notes}></textarea></label
		>

		{#if totals}
			{#each cryptoSubtotals(totals.lines) as sum (sum.asset)}
				<p class="text-right text-sm text-faint" data-testid="crypto-subtotal">
					{t('invoice.document.cryptoSubtotal', { quantity: sum.quantity, asset: sum.asset })}:
					<span class="font-mono">{formatMoney(sum.net, unit)}</span>
				</p>
			{/each}
			<p class="text-right text-sm text-heading" data-testid="draft-due">
				{t('invoice.app.editor.due')}:
				<span class="font-mono font-semibold">{formatMoney(totals.due, unit)}</span>
			</p>
		{/if}

		{#if problems.length > 0}
			<div
				class="rounded-md border border-data/50 bg-data-100/40 p-3 text-sm text-heading"
				data-testid="problems"
			>
				<p class="font-medium">{t('invoice.app.editor.problems')}</p>
				<ul class="mt-1 list-disc pl-5">
					{#each problems as problem, i (i)}<li data-code={problem.code}>
							{t(problem.code)}
						</li>{/each}
				</ul>
			</div>
		{/if}
		{#if warnings.length > 0}
			<div class="rounded-md border border-border p-3 text-sm" data-testid="warnings">
				<p class="font-medium">{t('invoice.app.editor.warnings')}</p>
				<ul class="mt-1 list-disc pl-5">
					{#each warnings as warning, i (i)}<li>{t(warning.code)}</li>{/each}
				</ul>
			</div>
		{/if}
		{#if error}<p class="text-sm text-danger" role="alert">{error}</p>{/if}

		<div class="flex flex-wrap items-center gap-2">
			<button
				type="button"
				class={secondary}
				disabled={busy}
				onclick={save}
				data-testid="save-draft">{t('invoice.form.save')}</button
			>
			<button
				type="button"
				class={primary}
				disabled={busy || problems.length > 0}
				onclick={issueNow}
				data-testid="issue">{t('invoice.app.editor.issue')}</button
			>
			{#if saved}<span class="text-sm text-success" role="status"
					>{t('invoice.app.editor.saved')}</span
				>{/if}
		</div>
	</section>
{/if}
