<script>
	// The shell, after Le-Space/belege (app/src/routes/+layout.svelte) at 9a40d22:
	// a header with the name and the passkey's DID, the tabs, the page. The
	// passkey comes first; nothing is shown before the store is open.
	import '../app.css';
	import { page } from '$app/state';
	import PasskeyOnboarding from '$lib/PasskeyOnboarding.svelte';
	import { t } from '$lib/i18n/index.js';
	import { app, lock } from '$lib/session.svelte.js';

	let { children } = $props();

	/** @param {string} did */
	const shortDid = (did) => (did.length > 24 ? `${did.slice(0, 14)}…${did.slice(-6)}` : did);

	let ready = $derived(app.status === 'ready');
	const tabs = [
		{
			href: '/',
			key: 'app.nav.invoices',
			match: (/** @type {string} */ p) => p === '/' || p.startsWith('/rechnung')
		},
		{
			href: '/verbindungen',
			key: 'app.nav.connections',
			match: (/** @type {string} */ p) => p.startsWith('/verbindungen')
		},
		{
			href: '/einstellungen',
			key: 'app.nav.settings',
			match: (/** @type {string} */ p) => p.startsWith('/einstellungen')
		}
	];
</script>

<div class="mx-auto max-w-5xl px-4 pt-4 pb-10 sm:px-6 sm:pt-6">
	<header class="mb-4 flex flex-wrap items-center justify-between gap-3 sm:mb-6">
		<div class="min-w-0">
			<p class="text-xl font-bold text-heading sm:text-3xl" data-testid="app-name">
				<span class="text-faint">Le Space</span>
				{t('app.name')}
			</p>
			<p class="mt-0.5 hidden text-sm text-faint sm:block">{t('app.tagline')}</p>
		</div>
		{#if ready && app.did}
			<div class="flex items-center gap-2">
				<span
					class="max-w-full truncate rounded-full border border-border bg-surface px-2.5 py-1 font-mono text-xs text-text"
					title={app.did}
					data-testid="own-did"
					data-did={app.did}>{shortDid(app.did)}</span
				>
				<button
					type="button"
					class="rounded-md border border-border bg-surface px-3 py-1 text-sm text-heading hover:bg-surface-2"
					onclick={lock}
					data-testid="lock">{t('app.lock')}</button
				>
			</div>
		{/if}
	</header>

	{#if !ready}
		<main>
			<PasskeyOnboarding />
		</main>
	{:else}
		<nav class="mb-4 flex gap-1 border-b border-border" aria-label={t('app.name')}>
			{#each tabs as tab (tab.href)}
				<a
					href={tab.href}
					class="-mb-px border-b-2 px-3 py-2 text-sm font-medium {tab.match(page.url.pathname)
						? 'border-coral text-heading'
						: 'border-transparent text-faint hover:text-heading'}"
					aria-current={tab.match(page.url.pathname) ? 'page' : undefined}>{t(tab.key)}</a
				>
			{/each}
		</nav>
		{#if app.restore.done}
			<p
				class="mb-4 rounded-md border border-border bg-surface px-3 py-2 text-sm text-heading"
				role="status"
				data-testid="restore-done"
			>
				{t('restore.done', {
					at: new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(
						new Date(app.restore.done.at)
					)
				})}
			</p>
		{/if}
		{#if app.keys.length === 1 && !page.url.pathname.startsWith('/einstellungen')}
			<p
				class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-data/40 bg-data/10 px-3 py-2 text-sm text-heading"
				data-testid="one-key-hint"
			>
				<span>{t('keys.onlyOne')}</span>
				<a href="/einstellungen#schluessel" class="font-medium underline"
					>{t('keys.onlyOneAction')}</a
				>
			</p>
		{/if}
		<main>
			{@render children()}
		</main>
	{/if}
</div>
