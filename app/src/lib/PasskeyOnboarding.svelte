<script>
	// Ported from Le-Space/belege (app/src/lib/PasskeyOnboarding.svelte) at 9a40d22
	// and published here under the MIT license by its author, unchanged but for
	// the words, which are the invoice app's (i18n/de.js).
	// Ported from Le-Space/simple-todo apps/invoice01 (src/lib/PasskeyOnboarding.svelte) at 56647d5.
	// Changed: Svelte 5 runes, German text, no anonymous identity and no
	// storage choice (belege always uses a passkey and always keeps its data),
	// and the buttons act directly instead of feeding a consent dialog — a
	// WebAuthn call needs the click's user gesture. The look follows
	// apps/escrow01 at f0d3df4: a card on the brand tokens, one coral action.
	import {
		app,
		createPasskey,
		restoreFromBackup,
		restorePasskey,
		unlockStoredPasskey
	} from './session.svelte.js';
	import { hasStoredPasskeyCredential } from './passkey-identity.js';
	import { listStoredPasskeys } from './stored-passkeys.js';
	import { t } from './i18n/index.js';

	const hasStoredPasskey = hasStoredPasskeyCredential();
	// More than one when a second key was added to the books: any of them opens.
	const storedPasskeys = listStoredPasskeys();
	let chosen = $state(storedPasskeys[0]?.credentialId ?? '');
	let label = $state('');
	let owner = $state('');
	let busy = $derived(app.status === 'starting');

	const primary =
		'w-full rounded-md bg-coral-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50';
	const secondary =
		'w-full rounded-md border border-border bg-surface px-4 py-2.5 text-sm font-medium text-heading hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50';
</script>

<section
	class="mx-auto mt-6 max-w-md rounded-xl border border-border bg-surface p-6 shadow-sm sm:mt-12"
	data-testid="passkey-onboarding"
>
	<h1 class="text-xl font-semibold text-heading">{t('onboarding.title')}</h1>
	<p class="mt-2 text-sm leading-relaxed text-text">{t('onboarding.intro')}</p>

	{#if hasStoredPasskey}
		{#if storedPasskeys.length > 1}
			<label class="mt-6 block text-sm font-medium text-heading" for="passkey-choice"
				>{t('onboarding.choose')}</label
			>
			<select
				id="passkey-choice"
				class="mt-1 w-full rounded-md border px-3 py-2 text-sm"
				bind:value={chosen}
				data-testid="passkey-choice"
			>
				{#each storedPasskeys as passkey (passkey.credentialId)}
					<option value={passkey.credentialId}>{passkey.label}</option>
				{/each}
			</select>
		{/if}
		<button
			type="button"
			class="mt-6 {primary}"
			disabled={busy}
			onclick={() => unlockStoredPasskey(chosen || undefined)}
			data-testid="passkey-unlock"
		>
			{t('onboarding.unlock')}
		</button>
	{/if}

	<div class="mt-6 space-y-2">
		<h2 class="text-xs font-semibold tracking-wide text-faint uppercase">
			{t('onboarding.newHeading')}
		</h2>
		<label class="block text-sm font-medium text-heading" for="passkey-label"
			>{t('onboarding.label')}</label
		>
		<input
			id="passkey-label"
			type="text"
			bind:value={label}
			placeholder={t('onboarding.labelPlaceholder')}
			class="w-full rounded-md border px-3 py-2 text-sm"
			data-testid="passkey-label"
		/>
		<p class="text-xs text-faint">{t('onboarding.labelHint')}</p>
		<button
			type="button"
			class={hasStoredPasskey ? secondary : primary}
			disabled={busy}
			onclick={() => createPasskey(label)}
			data-testid="passkey-create"
		>
			{t('onboarding.create')}
		</button>
	</div>

	<div class="mt-6 space-y-2 border-t border-border pt-4">
		<h2 class="text-xs font-semibold tracking-wide text-faint uppercase">
			{t('onboarding.restoreHeading')}
		</h2>
		<button
			type="button"
			class={secondary}
			disabled={busy}
			onclick={restorePasskey}
			data-testid="passkey-restore"
		>
			{t('onboarding.restore')}
		</button>
	</div>

	<div class="mt-6 space-y-2 border-t border-border pt-4" data-testid="restore-backup">
		<h2 class="text-xs font-semibold tracking-wide text-faint uppercase">
			{t('restore.heading')}
		</h2>
		<p class="text-xs leading-relaxed text-faint">{t('restore.hint')}</p>
		<label class="block text-sm font-medium text-heading" for="restore-owner"
			>{t('restore.ownerLabel')}</label
		>
		<input
			id="restore-owner"
			type="text"
			bind:value={owner}
			placeholder={t('restore.ownerPlaceholder')}
			autocomplete="off"
			spellcheck="false"
			class="w-full rounded-md border px-3 py-2 font-mono text-sm"
			data-testid="restore-owner"
		/>
		<button
			type="button"
			class={secondary}
			disabled={busy || !owner.trim()}
			onclick={() => restoreFromBackup(owner)}
			data-testid="restore-start"
		>
			{t('restore.start')}
		</button>
		{#if app.restore.step}
			<p class="text-sm text-text" role="status" data-testid="restore-step">
				{t(`restore.step.${app.restore.step}`, { found: String(app.restore.found ?? '') })}
			</p>
		{/if}
	</div>

	{#if busy}
		<p class="mt-4 text-sm text-text" role="status" data-testid="passkey-busy">
			{t('onboarding.busy')}
		</p>
	{/if}
	{#if app.status === 'error' && app.error}
		<p
			class="mt-4 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-heading"
			role="alert"
			data-testid="passkey-error"
		>
			{app.error}
		</p>
	{/if}
</section>
