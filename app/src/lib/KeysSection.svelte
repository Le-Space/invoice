<script>
	// The passkeys that open these books: one per slot in the books' vault
	// (books-vault.js). A second one is added here while the books are open; a
	// key is removed here too, never the last and never the one in use — also
	// one this browser does not keep, as a lost one usually is. Removing renews
	// the vault: every other key that stays is asked once.
	import { t } from './i18n/index.js';
	import { addKey, app, removeKey } from './session.svelte.js';

	let label = $state('');
	let busy = $derived(app.keysStatus !== 'idle');
	let onlyOne = $derived(app.keys.length === 1);

	const input = 'w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm';
	const primary =
		'rounded-md bg-coral-700 px-4 py-2 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50';
	const secondary =
		'rounded-md border border-border bg-surface px-3 py-1 text-sm text-heading hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50';

	async function add() {
		await addKey(label);
		if (!app.keysError) label = '';
	}
</script>

<section
	id="schluessel"
	class="space-y-3 rounded-lg border border-border bg-surface p-4"
	data-testid="keys"
>
	<h2 class="text-sm font-medium text-heading">{t('keys.heading')}</h2>
	<p class="text-sm leading-relaxed text-text">{t('keys.intro')}</p>

	<ul class="divide-y divide-border rounded-md border border-border">
		{#each app.keys as key (key.kid)}
			<li class="flex items-center justify-between gap-3 px-3 py-2" data-testid="key-row">
				<span class="min-w-0 truncate text-sm text-heading">
					{key.label ?? t('keys.unnamed')}
					{#if key.current}
						<span class="ml-2 rounded-full border border-border px-2 py-0.5 text-xs text-faint"
							>{t('keys.current')}</span
						>
					{/if}
				</span>
				{#if !key.current && !onlyOne}
					<button
						type="button"
						class={secondary}
						disabled={busy}
						onclick={() => removeKey(key.kid)}
						data-testid="key-remove">{t('keys.remove')}</button
					>
				{/if}
			</li>
		{/each}
	</ul>
	{#if !onlyOne}
		<p class="text-xs text-faint">{t('keys.removeHint')}</p>
	{/if}

	<div class="space-y-2 border-t border-border pt-3">
		<label class="block text-sm" for="key-label"
			><span class="block text-xs text-faint">{t('keys.addLabel')}</span></label
		>
		<input
			id="key-label"
			class={input}
			bind:value={label}
			placeholder={t('keys.addPlaceholder')}
			data-testid="key-label"
		/>
		<p class="text-xs text-faint">{t('keys.addHint')}</p>
		<button type="button" class={primary} disabled={busy} onclick={add} data-testid="key-add"
			>{onlyOne ? t('keys.add') : t('keys.addMore')}</button
		>
	</div>

	{#if app.keysStatus === 'adding'}
		<p class="text-sm text-text" role="status" data-testid="keys-busy">{t('keys.adding')}</p>
	{:else if app.keysStatus === 'removing'}
		<p class="text-sm text-text" role="status" data-testid="keys-busy">
			{app.keysConfirming ? t('keys.confirming', { key: app.keysConfirming }) : t('keys.removing')}
		</p>
	{/if}
	{#if app.keysError}
		<p
			class="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-heading"
			role="alert"
			data-testid="keys-error"
		>
			{app.keysError}
		</p>
	{/if}
</section>
