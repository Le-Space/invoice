<script>
	import { UNIT_MAX_LENGTH, circleOf, normaliseUnits } from '@le-space/invoice/settings';
	import { payToAddress } from '@le-space/invoice/payment-code';
	import { t } from '$lib/i18n/index.js';
	import { app, currentStore } from '$lib/session.svelte.js';
	import { saveSettings } from '$lib/invoices.js';

	/** A copy of the settings, written back on "Speichern". @type {any} */
	let form = $state(null);
	let saved = $state(false);
	let busy = $state(false);

	$effect(() => {
		if (app.settings && !form) form = structuredClone($state.snapshot(app.settings));
	});

	/** Which currency's address each field is checked as. */
	const cryptoFields = /** @type {const} */ ([
		['btc', 'BTC'],
		['eth', 'ETH']
	]);

	let newUnit = $state('');

	function addUnit() {
		const units = normaliseUnits([...form.units, newUnit]);
		form.units = units;
		newUnit = '';
	}

	/** @param {number} index */
	function removeUnit(index) {
		const gone = form.units[index];
		form.units = normaliseUnits(
			form.units.filter((/** @type {string} */ _, /** @type {number} */ i) => i !== index)
		);
		// A default that is gone falls back to the first unit left.
		if (form.defaultUnit === gone) form.defaultUnit = form.units[0];
		if (form.cryptoUnit === gone) form.cryptoUnit = form.units[0];
	}

	/** @param {string} key @param {string} currency */
	const invalid = (key, currency) =>
		Boolean(form?.issuer.crypto[key]?.trim()) && !payToAddress(currency, form.issuer.crypto);

	let series = $derived(app.settings && app.did ? circleOf(app.settings, app.did)?.pattern : '');

	async function save() {
		const store = currentStore();
		if (!store || !form) return;
		busy = true;
		try {
			await saveSettings(store, $state.snapshot(form));
			saved = true;
			setTimeout(() => (saved = false), 1500);
		} finally {
			busy = false;
		}
	}

	const input = 'w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm';
	const label = 'block text-xs text-faint';
	const box = 'grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2';
	const legend = 'px-1 text-sm font-medium text-heading';
</script>

{#if form}
	<section class="space-y-5" data-testid="settings">
		<h1 class="text-lg font-semibold text-heading">{t('invoice.app.settings.heading')}</h1>

		<fieldset class={box}>
			<legend class={legend}>{t('invoice.app.settings.issuer')}</legend>
			<label class="text-sm"
				><span class={label}>{t('invoice.app.settings.name')}</span>
				<input class={input} bind:value={form.issuer.name} data-testid="issuer-name" /></label
			>
			<label class="text-sm"
				><span class={label}>{t('invoice.app.settings.vatId')}</span>
				<input class={input} bind:value={form.issuer.vatId} /></label
			>
			<label class="text-sm sm:col-span-2"
				><span class={label}>{t('invoice.app.settings.address')}</span>
				<textarea
					class={input}
					rows="3"
					bind:value={form.issuer.address}
					data-testid="issuer-address"
				></textarea></label
			>
			<label class="text-sm"
				><span class={label}>{t('invoice.app.settings.taxNumber')}</span>
				<input class={input} bind:value={form.issuer.taxNumber} /></label
			>
			<label class="text-sm"
				><span class={label}>{t('invoice.app.settings.email')}</span>
				<input type="email" class={input} bind:value={form.issuer.email} /></label
			>
			<label class="text-sm"
				><span class={label}>{t('invoice.app.settings.phone')}</span>
				<input class={input} bind:value={form.issuer.phone} /></label
			>
			<label class="text-sm"
				><span class={label}>{t('invoice.app.settings.web')}</span>
				<input class={input} bind:value={form.issuer.web} /></label
			>
		</fieldset>

		<fieldset class={box}>
			<legend class={legend}>{t('invoice.app.settings.bank')}</legend>
			<label class="text-sm"
				><span class={label}>{t('invoice.app.settings.bankName')}</span>
				<input class={input} bind:value={form.issuer.bank.name} /></label
			>
			<label class="text-sm"
				><span class={label}>{t('invoice.app.settings.iban')}</span>
				<input class={input} bind:value={form.issuer.bank.iban} /></label
			>
			<label class="text-sm"
				><span class={label}>{t('invoice.app.settings.bic')}</span>
				<input class={input} bind:value={form.issuer.bank.bic} /></label
			>
		</fieldset>

		<fieldset class={box}>
			<legend class={legend}>{t('invoice.app.settings.crypto')}</legend>
			<p class="text-xs text-faint sm:col-span-2">{t('invoice.app.settings.cryptoHint')}</p>
			{#each cryptoFields as [key, currency] (key)}
				<label class="text-sm"
					><span class={label}>{t(`invoice.app.settings.${key}`)}</span>
					<input
						class="{input} font-mono {invalid(key, currency) ? 'border-danger' : ''}"
						bind:value={form.issuer.crypto[key]}
						spellcheck="false"
						data-testid={`crypto-${key}`}
					/>
					{#if invalid(key, currency)}
						<span class="text-xs text-danger" data-testid={`crypto-${key}-invalid`}
							>{t('invoice.app.settings.invalidAddress')}</span
						>
					{/if}
				</label>
			{/each}
		</fieldset>

		<fieldset class={box}>
			<legend class={legend}>{t('invoice.app.settings.units')}</legend>
			<p class="text-xs text-faint sm:col-span-2">{t('invoice.app.settings.unitsHint')}</p>
			<ul class="flex flex-wrap gap-2 sm:col-span-2" data-testid="units">
				{#each form.units as name, index (name)}
					<li
						class="flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm"
						data-testid="unit"
					>
						{name}
						<button
							type="button"
							class="text-faint hover:text-danger disabled:opacity-30"
							disabled={form.units.length <= 1}
							onclick={() => removeUnit(index)}
							aria-label={t('invoice.app.settings.unitRemove', { unit: name })}
							data-testid="unit-remove">✕</button
						>
					</li>
				{/each}
			</ul>
			<div class="flex gap-2 sm:col-span-2">
				<input
					class={input}
					bind:value={newUnit}
					maxlength={UNIT_MAX_LENGTH}
					placeholder={t('invoice.app.settings.unitNew')}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							addUnit();
						}
					}}
					data-testid="unit-new"
				/>
				<button
					type="button"
					class="rounded-md border border-border px-3 py-1.5 text-sm"
					disabled={!newUnit.trim()}
					onclick={addUnit}
					data-testid="unit-add">{t('invoice.app.settings.unitAdd')}</button
				>
			</div>
			<label class="text-sm"
				><span class={label}>{t('invoice.app.settings.defaultUnit')}</span>
				<select class={input} bind:value={form.defaultUnit} data-testid="default-unit">
					{#each form.units as name (name)}<option value={name}>{name}</option>{/each}
				</select></label
			>
			<label class="text-sm"
				><span class={label}>{t('invoice.app.settings.cryptoUnit')}</span>
				<select class={input} bind:value={form.cryptoUnit} data-testid="crypto-unit">
					{#each form.units as name (name)}<option value={name}>{name}</option>{/each}
				</select></label
			>
		</fieldset>

		<fieldset class={box}>
			<legend class={legend}>{t('invoice.app.settings.defaults')}</legend>
			<label class="text-sm"
				><span class={label}>{t('invoice.app.settings.taxMode')}</span>
				<select class={input} bind:value={form.taxMode}>
					{#each ['standard', 'kleinunternehmer', 'reverse-charge'] as mode (mode)}
						<option value={mode}>{t(`invoice.app.taxModes.${mode}`)}</option>
					{/each}
				</select></label
			>
			<label class="text-sm"
				><span class={label}>{t('invoice.app.settings.paymentTerms')}</span>
				<input type="number" min="0" class={input} bind:value={form.paymentTermsDays} /></label
			>
			<p class="text-sm sm:col-span-2">
				<span class={label}>{t('invoice.app.settings.series')}</span>
				<span class="font-mono" data-testid="series">{series}</span>
			</p>
		</fieldset>

		<div class="flex items-center gap-2">
			<button
				type="button"
				class="rounded-md bg-coral-700 px-4 py-2 text-sm font-medium text-white hover:bg-coral-800 disabled:opacity-50"
				disabled={busy}
				onclick={save}
				data-testid="save-settings">{t('invoice.app.settings.save')}</button
			>
			{#if saved}<span class="text-sm text-success" role="status"
					>{t('invoice.app.settings.saved')}</span
				>{/if}
		</div>
	</section>
{/if}
