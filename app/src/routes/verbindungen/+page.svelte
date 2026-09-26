<script>
	// Pairing, after Le-Space/ucep-spec ucep-auth.md: an invitation to show as a
	// QR code or to copy, or a short window in which an app may ask in-band —
	// then the same six digits on both screens, and this human says yes.
	import { renderSVG } from 'uqr';
	import { t } from '$lib/i18n/index.js';
	import { app, currentProvider } from '$lib/session.svelte.js';
	import { SCOPES } from '$lib/ucep/provider.js';

	let offer = $state({ [SCOPES.eigenbeleg]: true, [SCOPES.read]: true });
	let invitation = $state(/** @type {{ uri: string, expiresAt: number } | null} */ (null));
	let windowUntil = $state(0);
	/** @type {Record<string, string>} what the human typed per pending pairing */
	let codes = $state({});
	/** @type {string | null} */
	let error = $state(null);
	let copied = $state('');

	let svg = $derived(invitation ? renderSVG(invitation.uri, { border: 1 }) : '');

	async function invite() {
		error = null;
		const scopes = Object.entries(offer)
			.filter(([, on]) => on)
			.map(([scope]) => scope);
		try {
			invitation = await currentProvider()?.createInvitation({ scopes });
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	function openWindow() {
		currentProvider()?.openPairingWindow(2 * 60 * 1000);
		windowUntil = Date.now() + 2 * 60 * 1000;
	}

	/** @param {string} id */
	async function approve(id) {
		error = null;
		try {
			await currentProvider()?.approve(id, { code: (codes[id] ?? '').replace(/\s/g, '') });
		} catch {
			error = t('ucep.pairing.codeWrong');
		}
	}

	/** @param {string} id */
	async function deny(id) {
		await currentProvider()?.deny(id);
		app.ucep.pending = app.ucep.pending.filter((p) => p.id !== id);
	}

	/** @param {string} grantId */
	async function unpair(grantId) {
		await currentProvider()?.revoke(grantId);
	}

	/** @param {string} text @param {string} what */
	async function copy(text, what) {
		await navigator.clipboard?.writeText(text).catch(() => {});
		copied = what;
		setTimeout(() => (copied = ''), 1500);
	}

	/** @param {number} ms */
	const when = (ms) => new Date(ms).toLocaleString('de-DE');
	/** @param {string} did */
	const shortDid = (did) => (did && did.length > 24 ? `${did.slice(0, 14)}…${did.slice(-6)}` : did);

	const box = 'space-y-3 rounded-lg border border-border bg-surface p-4';
	const heading = 'text-sm font-medium text-heading';
	const primary =
		'rounded-md bg-coral-700 px-4 py-2 text-sm font-medium text-white hover:bg-coral-800 disabled:opacity-50';
	const secondary =
		'rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-heading hover:bg-surface-2 disabled:opacity-50';
</script>

<section class="space-y-5" data-testid="connections">
	<h1 class="text-lg font-semibold text-heading">{t('ucep.pairing.heading')}</h1>
	<p class="text-sm text-text">{t('ucep.pairing.intro')}</p>

	<div class={box}>
		<h2 class={heading}>{t('ucep.pairing.thisApp')}</h2>
		{#if app.ucep.status === 'running'}
			<p class="text-sm">
				<span
					class="rounded-full px-2 py-0.5 text-xs font-medium {app.ucep.online
						? 'bg-success/15 text-success'
						: 'bg-data-100 text-data-800'}"
					data-testid="ucep-online"
					data-online={app.ucep.online}
					>{app.ucep.online ? t('ucep.pairing.online') : t('ucep.pairing.offline')}</span
				>
			</p>
			<p class="flex flex-wrap items-center gap-2 text-sm">
				<span class="text-faint">{t('ucep.pairing.peerId')}</span>
				<code class="font-mono text-xs break-all" data-testid="ucep-peer-id">{app.ucep.peerId}</code
				>
				<button type="button" class={secondary} onclick={() => copy(app.ucep.peerId ?? '', 'peer')}
					>{copied === 'peer' ? t('ucep.pairing.copied') : t('ucep.pairing.copy')}</button
				>
			</p>
		{:else if app.ucep.status === 'failed'}
			<p class="text-sm text-danger" role="alert">{t('ucep.pairing.failed')} {app.ucep.error}</p>
		{:else}
			<p class="text-sm text-faint">{t('ucep.pairing.starting')}</p>
		{/if}
	</div>

	<div class={box}>
		<h2 class={heading}>{t('ucep.pairing.invitationHeading')}</h2>
		<p class="text-xs text-faint">{t('ucep.pairing.invitationHint')}</p>
		{#each [SCOPES.eigenbeleg, SCOPES.read] as scope (scope)}
			<label class="flex items-start gap-2 text-sm">
				<input type="checkbox" bind:checked={offer[scope]} class="mt-0.5" />
				<span
					><code class="text-xs">{scope}</code> – {t(
						scope === SCOPES.read ? 'ucep.scopes.read' : 'ucep.scopes.eigenbeleg'
					)}</span
				>
			</label>
		{/each}
		<button
			type="button"
			class={primary}
			disabled={app.ucep.status !== 'running' || !Object.values(offer).some(Boolean)}
			onclick={invite}
			data-testid="create-invitation">{t('ucep.pairing.invite')}</button
		>
		{#if invitation}
			<div class="flex flex-wrap items-start gap-4">
				<div class="w-48 rounded bg-white p-1" aria-label={t('ucep.pairing.qr')}>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- uqr's SVG of our own invitation -->
					{@html svg}
				</div>
				<div class="min-w-0 flex-1 space-y-2">
					<textarea
						class="w-full rounded-md border border-border bg-surface-2 p-2 font-mono text-xs"
						rows="4"
						readonly
						data-testid="invitation-uri">{invitation.uri}</textarea
					>
					<div class="flex flex-wrap items-center gap-2">
						<button
							type="button"
							class={secondary}
							onclick={() => copy(invitation?.uri ?? '', 'uri')}
							>{copied === 'uri' ? t('ucep.pairing.copied') : t('ucep.pairing.copy')}</button
						>
						<span class="text-xs text-faint"
							>{t('ucep.pairing.expires', { when: when(invitation.expiresAt * 1000) })}</span
						>
					</div>
				</div>
			</div>
		{/if}
	</div>

	<div class={box}>
		<h2 class={heading}>{t('ucep.pairing.inBandHeading')}</h2>
		<p class="text-xs text-faint">{t('ucep.pairing.inBandHint')}</p>
		<button
			type="button"
			class={secondary}
			disabled={app.ucep.status !== 'running'}
			onclick={openWindow}
			data-testid="open-window"
			>{windowUntil > Date.now()
				? t('ucep.pairing.windowOpen')
				: t('ucep.pairing.openWindow')}</button
		>
		{#each app.ucep.pending as pending (pending.id)}
			<div
				class="space-y-2 rounded-md border border-data/50 bg-data-100/40 p-3 text-sm"
				data-testid="pending-pairing"
			>
				<p>
					<strong>{pending.label || t('ucep.pairing.unnamed')}</strong>
					{#if pending.did}<span class="font-mono text-xs"> · {shortDid(pending.did)}</span>{/if}
				</p>
				<p class="text-xs text-faint">{pending.scopes.join(', ')}</p>
				<label class="block text-sm"
					><span class="block text-xs text-faint">{t('ucep.pairing.typeCode')}</span>
					<input
						class="w-32 rounded-md border border-border bg-surface px-2 py-1 font-mono tracking-widest"
						inputmode="numeric"
						maxlength="7"
						bind:value={codes[pending.id]}
						data-testid="pairing-code"
					/></label
				>
				<div class="flex gap-2">
					<button
						type="button"
						class={primary}
						onclick={() => approve(pending.id)}
						data-testid="approve-pairing">{t('ucep.pairing.approve')}</button
					>
					<button type="button" class={secondary} onclick={() => deny(pending.id)}
						>{t('ucep.pairing.deny')}</button
					>
				</div>
			</div>
		{/each}
	</div>

	{#if error}<p class="text-sm text-danger" role="alert">{error}</p>{/if}

	<div class={box}>
		<h2 class={heading}>{t('ucep.pairing.grantsHeading')}</h2>
		{#if app.ucep.grants.length === 0}
			<p class="text-sm text-faint" data-testid="no-grants">{t('ucep.pairing.noGrants')}</p>
		{:else}
			<ul class="divide-y divide-border">
				{#each app.ucep.grants as grant (grant.grantId)}
					<li
						class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
						data-testid="grant"
					>
						<div class="min-w-0">
							<p class="font-medium text-heading">{grant.label || t('ucep.pairing.unnamed')}</p>
							<p class="text-xs text-faint">
								{grant.scopes.join(', ')} · {t('ucep.pairing.since', {
									when: when(grant.createdAt)
								})}
								{#if grant.did}· <span class="font-mono">{shortDid(grant.did)}</span>{/if}
							</p>
							<p class="font-mono text-xs break-all text-faint">{grant.consumerPeerId}</p>
						</div>
						<button
							type="button"
							class={secondary}
							onclick={() => unpair(grant.grantId)}
							data-testid="unpair">{t('ucep.pairing.unpair')}</button
						>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>
