// After Le-Space/belege (app/src/lib/session.svelte.js) at 9a40d22, published
// here under the MIT license by its author. Kept: the passkey flow (create,
// restore, unlock) and the lazy start of Helia and OrbitDB. Changed: the
// state is an invoice list's — invoices, customers and the invoice settings.
//
// App-wide state: who is signed in, and the records the pages show.
import {
	createPasskeyCredential,
	loadStoredPasskeyCredential,
	restorePasskeyCredential
} from './passkey-identity.js';
import { getSetting } from './store/settings.js';
import { normaliseInvoiceSettings } from '@le-space/invoice/settings';
import { foldCancellations, upgradeInvoice } from '@le-space/invoice/records';
import { t } from './i18n/index.js';

/** @typedef {import('./node.js').Session} Session */
/** @typedef {import('./store/repository.js').StoredRecord} StoredRecord */

/** The settings key the invoice settings are kept under. */
export const SETTINGS_KEY = 'invoice';

export const app = $state({
	/** @type {'locked' | 'starting' | 'ready' | 'error'} */
	status: 'locked',
	/** @type {string | null} */
	error: null,
	/** @type {string | null} */
	did: null,
	/** @type {any[]} every invoice, upgraded, with `cancelledBy` folded in; newest first */
	invoices: [],
	/** @type {StoredRecord[]} */
	customers: [],
	/** @type {ReturnType<typeof normaliseInvoiceSettings> | null} */
	settings: null,
	/** What the UCEP node is doing (ucep/): paired apps reach this one through it. */
	ucep: {
		/** @type {'off' | 'starting' | 'running' | 'failed'} */
		status: 'off',
		/** @type {string | null} */
		peerId: null,
		/** whether a relay holds a reservation for us, so another browser can reach us */
		online: false,
		/** @type {string | null} */
		error: null,
		/** @type {any[]} pairings waiting for the human's word (PendingPairing) */
		pending: [],
		/** @type {any[]} the apps paired with this one (Grant) */
		grants: []
	}
});

/** @type {{ node: any, provider: any, relays: string[] } | null} */
let ucep = null;

/** Only when an app is paired: a grant is kept in the sealed settings. */
async function startUcepIfPaired() {
	if (!session) return;
	const grants = await session.store.settings.list({
		where: (r) => typeof r.key === 'string' && r.key.startsWith('ucep/grant/') && r.value
	});
	if (grants.length > 0) await startUcep();
}

/** The running provider, for the pairing page. */
export function currentProvider() {
	return ucep?.provider ?? null;
}

/** The node and its relays, for the addresses an invitation carries. */
export function currentUcep() {
	return ucep;
}

async function refreshGrants() {
	if (ucep) app.ucep.grants = await ucep.provider.grants();
}

/**
 * Start UCEP: after unlocking only when an app is paired (the relay sees this
 * device's IP address, and nobody who does not use UCEP should pay that),
 * otherwise when the person asks for it under "Verbindungen". In the
 * background: a relay that cannot be reached must not keep anybody from their
 * invoices.
 */
export async function startUcep() {
	if (!session || ucep) return;
	app.ucep.status = 'starting';
	app.ucep.error = null;
	try {
		const { startUcepNode, relayAddrs, reachable } = await import('./ucep/net.js');
		const { createInvoiceProvider } = await import('./ucep/provider.js');
		// The trusted Le-Space relays as Aleph knows them now (ucep/net.js).
		const relays = await relayAddrs();
		const node = await startUcepNode({ seed: session.ucepSeed, relays });
		const provider = createInvoiceProvider({
			libp2p: node,
			store: session.store,
			// A plain copy: the provider clones the issuer into the record, and a
			// Svelte state proxy cannot be cloned.
			settings: () => $state.snapshot(app.settings),
			t
		});
		await provider.start();
		ucep = { node, provider, relays };
		app.ucep.peerId = node.peerId.toString();
		const online = () => (app.ucep.online = reachable(node));
		node.addEventListener('connection:open', online);
		node.addEventListener('connection:close', online);
		node.addEventListener('self:peer:update', online);
		online();
		provider.events.addEventListener('pairing:pending', (/** @type {any} */ e) => {
			app.ucep.pending = [...app.ucep.pending.filter((p) => p.id !== e.detail.id), e.detail];
		});
		provider.events.addEventListener('pairing:granted', (/** @type {any} */ e) => {
			app.ucep.pending = app.ucep.pending.filter((p) => p.peerId !== e.detail.consumerPeerId);
			refreshGrants();
		});
		provider.events.addEventListener('grant:revoked', () => refreshGrants());
		await refreshGrants();
		app.ucep.status = 'running';
	} catch (error) {
		console.error('UCEP did not start:', error);
		app.ucep.status = 'failed';
		app.ucep.error = error instanceof Error ? error.message : String(error);
	}
}

/** @type {Session | null} */
let session = null;

/** @returns {Session['store'] | null} */
export function currentStore() {
	return session?.store ?? null;
}

export async function refresh() {
	if (!session || !app.did) return;
	const [invoices, customers, stored] = await Promise.all([
		session.store.invoices.list(),
		session.store.customers.list(),
		getSetting(session.store.settings, SETTINGS_KEY)
	]);
	app.invoices = foldCancellations(
		invoices.map((invoice) => /** @type {any} */ (upgradeInvoice(invoice)))
	);
	app.customers = customers;
	app.settings = normaliseInvoiceSettings(stored, app.did);
}

/** @type {ReturnType<typeof setTimeout> | null} */
let pending = null;
function scheduleRefresh() {
	if (pending) return;
	pending = setTimeout(() => {
		pending = null;
		refresh();
	}, 50);
}

/** @param {any} credential */
async function unlockWith(credential) {
	// Loaded lazily: Helia, libp2p and OrbitDB are most of the bundle, and the
	// onboarding screen needs none of them.
	const { startSession } = await import('./node.js');
	session = await startSession(credential);
	app.did = session.did;
	for (const name of /** @type {const} */ (['invoices', 'customers', 'settings'])) {
		session.store[name].onChange(scheduleRefresh);
	}
	await refresh();
	installE2EHooks();
	// Not awaited: the books are open, whatever the relay does.
	startUcepIfPaired();
}

/**
 * @param {() => Promise<any>} getCredential
 * @param {string} nothingFound shown when the credential step finds nothing
 */
async function run(getCredential, nothingFound) {
	app.status = 'starting';
	app.error = null;
	try {
		const credential = await getCredential();
		if (!credential) throw new Error(nothingFound);
		await unlockWith(credential);
		app.status = 'ready';
	} catch (error) {
		console.error('unlock failed:', error);
		app.status = 'error';
		app.error = error instanceof Error ? error.message : String(error);
	}
}

/** @param {string} label shown in the passkey picker; identifies nothing */
export function createPasskey(label) {
	const name = label.trim() || 'Le Space Rechnungen';
	return run(
		() => createPasskeyCredential({ userId: `invoice-${crypto.randomUUID()}`, displayName: name }),
		t('onboarding.createFailed')
	);
}

export function restorePasskey() {
	return run(() => restorePasskeyCredential(), t('onboarding.restoreFailed'));
}

export function unlockStoredPasskey() {
	return run(async () => loadStoredPasskeyCredential(), t('onboarding.unlockFailed'));
}

/** Close the store and forget the session: the keys go with it. */
export async function lock() {
	const closing = session;
	const closingUcep = ucep;
	session = null;
	ucep = null;
	app.ucep = { status: 'off', peerId: null, online: false, error: null, pending: [], grants: [] };
	await closingUcep?.provider.stop().catch(() => {});
	await closingUcep?.node.stop().catch(() => {});
	app.status = 'locked';
	app.did = null;
	app.invoices = [];
	app.customers = [];
	app.settings = null;
	await closing?.stop();
}

/**
 * A dev/E2E-only hook: the test reads the DID and the secrets to look for them
 * on disk.
 */
function installE2EHooks() {
	if (!(import.meta.env.DEV || import.meta.env.VITE_E2E === 'true')) return;
	/** @param {Uint8Array} bytes */
	const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	/** @type {any} */ (window).__invoiceE2E = {
		did: () => app.did,
		identityHash: () => session?.identityHash,
		peerId: () => session?.peerId,
		ucepPeerId: () => app.ucep.peerId,
		ucepOnline: () => app.ucep.online,
		secrets: () => {
			const s = session?.secretsForE2E;
			return s
				? {
						signingKey: hex(s.signingKey),
						databaseKey: hex(s.databaseKey),
						peerKey: hex(s.peerKey),
						ucepSeed: hex(s.ucepSeed)
					}
				: null;
		}
	};
}
