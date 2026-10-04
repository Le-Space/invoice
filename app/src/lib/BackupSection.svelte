<script>
	// The books' backup on Aleph (backup.js): this key's address, the paying
	// account and whether it lets this key keep backups, "Jetzt sichern", and
	// the backups made so far.
	import { onMount } from 'svelte';
	import { BACKUP_CHANNEL } from './backup.js';
	import { t } from './i18n/index.js';
	import { app, backUpNow, refreshBackup, setBackupOwner } from './session.svelte.js';

	let owner = $state('');
	let checking = $state(false);
	let busy = $derived(Boolean(app.backup.step));
	let command = $derived(
		app.backup.address
			? `pnpm setup:aleph -- --authorize ${app.backup.address} --channel ${BACKUP_CHANNEL}`
			: ''
	);

	const input = 'w-full rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-sm';
	const primary =
		'rounded-md bg-coral-700 px-4 py-2 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50';
	const secondary =
		'rounded-md border border-border bg-surface px-3 py-1 text-sm text-heading hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50';

	async function check() {
		checking = true;
		try {
			await refreshBackup();
		} finally {
			checking = false;
		}
	}

	onMount(async () => {
		await check();
		owner = app.backup.owner ?? '';
	});

	async function saveOwner() {
		await setBackupOwner(owner);
		if (!app.backup.error && app.backup.owner) owner = app.backup.owner;
	}

	/** @param {number} bytes */
	const size = (bytes) =>
		bytes < 1024 * 1024
			? `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('de-DE')} KB`
			: `${(bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
	/** @param {Record<string, number>} entries */
	const total = (entries) => Object.values(entries ?? {}).reduce((n, e) => n + e, 0);
	/** @param {string} iso */
	const when = (iso) =>
		new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(iso)
		);
	/** @param {string} status */
	const kept = (status) => (status === 'processed' ? t('backup.kept') : t('backup.pending'));
</script>

<section
	id="sicherung"
	class="space-y-3 rounded-lg border border-border bg-surface p-4"
	data-testid="backup"
>
	<h2 class="text-sm font-medium text-heading">{t('backup.heading')}</h2>
	<p class="text-sm leading-relaxed text-text">{t('backup.intro')}</p>

	<dl class="space-y-2 text-sm">
		<div>
			<dt class="text-xs text-faint">{t('backup.address')}</dt>
			<dd class="font-mono break-all text-heading select-all" data-testid="backup-address">
				{app.backup.address ?? '…'}
			</dd>
		</div>
	</dl>

	<div class="space-y-2 border-t border-border pt-3">
		<label class="block text-sm" for="backup-owner"
			><span class="block text-xs text-faint">{t('backup.ownerLabel')}</span></label
		>
		<div class="flex flex-wrap gap-2">
			<input
				id="backup-owner"
				class="{input} min-w-0 flex-1"
				bind:value={owner}
				placeholder={t('backup.ownerPlaceholder')}
				autocomplete="off"
				spellcheck="false"
				data-testid="backup-owner"
			/>
			<button
				type="button"
				class={secondary}
				disabled={busy || !owner.trim()}
				onclick={saveOwner}
				data-testid="backup-owner-save">{t('backup.ownerSave')}</button
			>
		</div>
		<p class="text-xs text-faint">{t('backup.ownerHint')}</p>
	</div>

	{#if app.backup.owner}
		<div class="space-y-2 border-t border-border pt-3 text-sm">
			{#if app.backup.granted === true}
				<p class="text-heading" data-testid="backup-granted">{t('backup.granted')}</p>
			{:else if app.backup.granted === false}
				<p class="text-heading" data-testid="backup-not-granted">{t('backup.notGranted')}</p>
				<pre
					class="overflow-x-auto rounded-md border border-border bg-surface-2 p-2 font-mono text-xs select-all"
					data-testid="backup-grant-command">{command}</pre>
			{:else}
				<p class="text-faint" data-testid="backup-grant-unknown">{t('backup.grantUnknown')}</p>
			{/if}
			<p class="text-text">
				<span class="text-faint">{t('backup.credits')}:</span>
				<span data-testid="backup-credits"
					>{app.backup.credits === null
						? t('backup.creditsUnknown')
						: t('backup.creditsValue', {
								credits: Math.floor(app.backup.credits).toLocaleString('de-DE')
							})}</span
				>
			</p>
			<div class="flex flex-wrap items-center gap-3">
				<button
					type="button"
					class={primary}
					disabled={busy || app.backup.granted === false}
					onclick={backUpNow}
					data-testid="backup-now">{t('backup.now')}</button
				>
				<button
					type="button"
					class={secondary}
					disabled={busy || checking}
					onclick={check}
					data-testid="backup-check">{t('backup.check')}</button
				>
			</div>
		</div>
	{/if}

	{#if app.backup.step}
		<p class="text-sm text-text" role="status" data-testid="backup-step">
			{#if app.backup.step === 'packing'}
				{app.backup.progress
					? t('backup.step.packing', {
							name: app.backup.progress.name,
							index: app.backup.progress.index + 1,
							total: app.backup.progress.total
						})
					: t('backup.step.packingStart')}
			{:else}
				{t(`backup.step.${app.backup.step}`)}
			{/if}
		</p>
	{/if}
	{#if app.backup.made}
		<p class="text-sm text-heading" role="status" data-testid="backup-made">
			{t('backup.made', {
				size: size(app.backup.made.size),
				entries: total(app.backup.made.entries),
				kept: kept(app.backup.made.status)
			})}
		</p>
	{/if}
	{#if app.backup.error}
		<p
			class="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-heading"
			role="alert"
			data-testid="backup-error"
		>
			{app.backup.error}
		</p>
	{/if}

	<div class="space-y-2 border-t border-border pt-3">
		<h3 class="text-xs text-faint">{t('backup.history')}</h3>
		{#if app.backup.history.length === 0}
			<p class="text-sm text-faint">{t('backup.none')}</p>
		{:else}
			<ul class="divide-y divide-border rounded-md border border-border">
				{#each app.backup.history as record (record.itemHash)}
					<li class="space-y-0.5 px-3 py-2 text-sm" data-testid="backup-row">
						<p class="text-heading">
							{when(record.at)} · {size(record.size)} · {kept(record.status)}
						</p>
						<p class="font-mono text-xs break-all text-faint">
							{t('backup.cid')}: {record.cid}
						</p>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<p class="text-xs leading-relaxed text-faint">{t('backup.leaves')}</p>
</section>
