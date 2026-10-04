// After Le-Space/belege (app/src/lib/session.svelte.js) at 9a40d22, published
// here under the MIT license by its author. Kept: the passkey flow (create,
// restore, unlock) and the lazy start of Helia and OrbitDB. Changed: the
// state is an invoice list's — invoices, customers and the invoice settings.
//
// App-wide state: who is signed in, and the records the pages show.
import {
	createPasskeyCredential,
	loadStoredPasskeyCredential,
	readPrfOutput,
	restorePasskeyCredential
} from './passkey-identity.js';
import { WebAuthnDIDProvider, slotIdFor } from '@le-space/orbitdb-identity-provider-webauthn-did';
import {
	addBooksSlot,
	booksHereFor,
	booksSlotIds,
	installBooksVault,
	removeBooksSlot,
	uninstallBooksVault
} from './books-vault.js';
import {
	forgetPasskey,
	keepDefaultAside,
	listStoredPasskeys,
	makeDefaultPasskey,
	rememberPasskey
} from './stored-passkeys.js';
import { getSetting } from './store/settings.js';
import {
	BackupRefusedError,
	appRelease,
	backupAddressOf,
	backupMoment,
	buildBackup,
	creditsOf,
	findBackups,
	isAddress,
	isGranted,
	keepBackup,
	loadBackupOwner,
	loadBackups,
	pickBackup,
	rememberBackup,
	saveBackupOwner
} from './backup.js';
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
	/**
	 * The passkeys that open these books: one per slot in the vault, labelled
	 * from what this browser keeps. `current` unlocked this session.
	 * @type {{ credentialId: string | null, label: string | null, current: boolean }[]}
	 */
	keys: [],
	/** @type {'idle' | 'adding' | 'removing'} */
	keysStatus: 'idle',
	/** @type {string | null} */
	keysError: null,
	/** The books' backup on Aleph (backup.js). */
	backup: {
		/** @type {string | null} the address of the books' Aleph key: what a grant names */
		address: null,
		/** @type {string | null} the paying account */
		owner: null,
		/** @type {boolean | null} whether the account lets this key keep backups; null: not known */
		granted: null,
		/** @type {number | null} the account's credits; null: not known */
		credits: null,
		/** @type {import('./backup.js').BackupRecord[]} newest first */
		history: [],
		/** @type {'' | 'packing' | 'sealing' | 'uploading' | 'keeping'} */
		step: '',
		/** @type {{ name: string, index: number, total: number } | null} */
		progress: null,
		/** @type {string | null} */
		error: null,
		/** @type {import('./backup.js').BackupRecord | null} the one made just now */
		made: null
	},
	/** Books brought back from a backup on an empty device (backup.js). */
	restore: {
		/** @type {'' | 'searching' | 'passkey' | 'fetching' | 'unlocking' | 'restoring'} */
		step: '',
		/** @type {number | null} backups found for the account */
		found: null,
		/** @type {{ at: string } | null} which backup the books came back from */
		done: null
	},
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

/**
 * The vault's slots, each named after the passkey this browser keeps for it.
 * A slot whose passkey is kept nowhere here still counts, without a name.
 */
async function refreshKeys() {
	if (!session) {
		app.keys = [];
		return;
	}
	const stored = listStoredPasskeys();
	/** @type {Record<string, { credentialId: string, label: string }>} */
	const byKid = {};
	for (const passkey of stored) {
		byKid[await slotIdFor(passkey.credential.rawCredentialId)] = passkey;
	}
	app.keys = booksSlotIds(session.vault).map((kid) => {
		const passkey = byKid[kid];
		return {
			credentialId: passkey?.credentialId ?? null,
			label: passkey?.label ?? null,
			current: passkey?.credentialId === session?.credentialId
		};
	});
}

/** @param {unknown} error */
const message = (error) => (error instanceof Error ? error.message : String(error));

/**
 * One more passkey for these books — a second security key, say. Two
 * ceremonies on the new key: creating it, and the PRF answer its slot is
 * sealed with. The books stay open throughout.
 *
 * @param {string} label shown in the passkey picker and in the list
 */
export async function addKey(label) {
	if (!session || app.keysStatus !== 'idle') return;
	app.keysStatus = 'adding';
	app.keysError = null;
	try {
		const name = label.trim() || t('keys.defaultLabel');
		const credential = await WebAuthnDIDProvider.createCredential({
			userId: `invoice-${crypto.randomUUID()}`,
			displayName: name
		});
		const prfOutput = await readPrfOutput(credential);
		session.vault = await addBooksSlot(session.vault, {
			prfOutput,
			rawCredentialId: credential.rawCredentialId
		});
		rememberPasskey(credential, name);
		await refreshKeys();
	} catch (error) {
		console.error('adding a key failed:', error);
		app.keysError = message(error);
	} finally {
		app.keysStatus = 'idle';
	}
}

/**
 * A passkey no longer opens these books. Not the last one, and not the one
 * that unlocked them now: nobody can lock themselves out here.
 *
 * @param {string} credentialId
 */
export async function removeKey(credentialId) {
	if (!session || app.keysStatus !== 'idle') return;
	if (credentialId === session.credentialId) {
		app.keysError = t('keys.notCurrent');
		return;
	}
	const passkey = listStoredPasskeys().find((p) => p.credentialId === credentialId);
	if (!passkey) return;
	app.keysStatus = 'removing';
	app.keysError = null;
	try {
		session.vault = await removeBooksSlot(session.vault, passkey.credential.rawCredentialId);
		forgetPasskey(credentialId);
		await refreshKeys();
	} catch (error) {
		console.error('removing a key failed:', error);
		app.keysError = message(error);
	} finally {
		app.keysStatus = 'idle';
	}
}

/** The backup's state: this key's address, the paying account, its grant and credits, the backups made. */
export async function refreshBackup() {
	if (!session) return;
	const { values } = session.vault;
	const settings = session.store.settings;
	app.backup.address = values.alephKey ? await backupAddressOf(values.alephKey) : null;
	app.backup.owner = await loadBackupOwner(settings);
	app.backup.history = await loadBackups(settings);
	app.backup.granted = null;
	app.backup.credits = null;
	const { owner, address } = app.backup;
	if (!owner || !address) return;
	const [granted, credits] = await Promise.allSettled([
		isGranted({ owner, address }),
		creditsOf({ owner })
	]);
	app.backup.granted = granted.status === 'fulfilled' ? granted.value : null;
	app.backup.credits = credits.status === 'fulfilled' ? credits.value : null;
}

/** @param {string} address the paying account's */
export async function setBackupOwner(address) {
	if (!session) return;
	app.backup.error = null;
	if (!isAddress(address)) {
		app.backup.error = t('backup.ownerInvalid');
		return;
	}
	await saveBackupOwner(session.store.settings, address);
	await refreshBackup();
}

/**
 * "Jetzt sichern": the file built in this browser, uploaded from it, and kept
 * by a STORE this browser signs for the paying account.
 */
export async function backUpNow() {
	if (!session || app.backup.step) return;
	const { values, vault } = session.vault;
	const owner = app.backup.owner;
	if (!owner || !values.backupKey || !values.alephKey) return;
	app.backup.error = null;
	app.backup.made = null;
	const { at, name } = backupMoment();
	try {
		app.backup.step = 'packing';
		const built = await buildBackup({
			databases: session.store.databases(),
			vault: vault,
			backupKey: values.backupKey,
			appVersion: appRelease(),
			now: () => at,
			onProgress: (/** @type {any} */ p) => {
				if (p.stage === 'database') {
					app.backup.progress = { name: p.name, index: p.index, total: p.total };
				} else app.backup.step = 'sealing';
			}
		});
		app.backup.progress = null;
		const kept = await keepBackup({
			bytes: built.bytes,
			name,
			owner,
			alephKey: values.alephKey,
			onStep: (step) => (app.backup.step = step)
		});
		/** @type {import('./backup.js').BackupRecord} */
		const record = {
			at: at.toISOString(),
			cid: kept.cid,
			size: built.bytes.length,
			status: kept.status,
			itemHash: kept.itemHash,
			owner,
			sender: kept.sender,
			entries: Object.fromEntries(
				built.manifest.metadata.databases.map((/** @type {any} */ d) => [
					d.collection,
					d.entryCount
				])
			)
		};
		app.backup.history = await rememberBackup(session.store.settings, record);
		app.backup.made = record;
	} catch (error) {
		console.error('the backup failed:', error);
		app.backup.error =
			error instanceof BackupRefusedError
				? error.kind === 'credits'
					? t('backup.refusedCredits', {
							credits: Number(error.reason.credits).toLocaleString('de-DE'),
							required: Number(error.reason.required).toLocaleString('de-DE')
						})
					: t('backup.refused', { code: String(error.reason.errorCode ?? '?') })
				: t('backup.failed', { error: message(error) });
	} finally {
		app.backup.step = '';
		app.backup.progress = null;
	}
	// What a backup costs shows on the account's credits.
	if (app.backup.owner) {
		app.backup.credits = await creditsOf({ owner: app.backup.owner }).catch(
			() => app.backup.credits
		);
	}
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
	// The passkey that unlocked is the one the button uses next time.
	makeDefaultPasskey(session.credentialId);
	await refreshKeys();
	watchStore();
	await refresh();
	installE2EHooks();
	// Not awaited: the books are open, whatever the relay does.
	startUcepIfPaired();
}

/** Refresh the pages when the books change — again after a restore reopened the store. */
function watchStore() {
	if (!session) return;
	for (const name of /** @type {const} */ (['invoices', 'customers', 'settings'])) {
		session.store[name].onChange(scheduleRefresh);
	}
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
	return run(() => {
		keepDefaultAside();
		return createPasskeyCredential({ userId: `invoice-${crypto.randomUUID()}`, displayName: name });
	}, t('onboarding.createFailed'));
}

export function restorePasskey() {
	return run(async () => {
		keepDefaultAside();
		const credential = await restorePasskeyCredential();
		if (!credential) return null;
		// An empty device looks for a backup before it makes new books
		// (Le-Space/invoice#28): unlocking a passkey this browser has no books for
		// would start empty ones. A removed passkey is turned away as before.
		const here = await booksHereFor(credential.rawCredentialId);
		if (!here.slot && !here.removed && !window.confirm(t('onboarding.noBooksHere'))) {
			forgetPasskey(credential.credentialId);
			throw new Error(t('onboarding.noNewBooks'));
		}
		return credential;
	}, t('onboarding.restoreFailed'));
}

/**
 * "Bücher aus einer Sicherung holen": on an empty device, with nothing but the
 * paying account's address and a passkey registered for the books. The
 * account's backups are listed on Aleph; the passkey is fetched from its
 * authenticator (two touches); the newest backup whose vault has a slot for it
 * is fetched, its vault put into this browser, the books unlocked as usual
 * (one touch) and the backup put back into them.
 *
 * @param {string} ownerAddress
 */
export async function restoreFromBackup(ownerAddress) {
	if (app.status === 'starting') return;
	app.status = 'starting';
	app.error = null;
	app.restore = { step: 'searching', found: null, done: null };
	/** @type {string | null} */
	let installed = null;
	let unlocked = false;
	try {
		if (!isAddress(ownerAddress)) throw new Error(t('restore.ownerInvalid'));
		const { toChecksumAddress } = await import('./aleph-signer.js');
		const stores = await findBackups({ owner: toChecksumAddress(ownerAddress.trim()) });
		app.restore.found = stores.length;
		if (stores.length === 0) throw new Error(t('restore.none'));

		app.restore.step = 'passkey';
		keepDefaultAside();
		const credential = await restorePasskeyCredential();
		if (!credential) throw new Error(t('onboarding.restoreFailed'));

		app.restore.step = 'fetching';
		const { picked, unreachable } = await pickBackup({
			stores,
			rawCredentialId: credential.rawCredentialId
		});
		if (!picked) {
			throw new Error(
				unreachable === stores.length ? t('restore.unreachable') : t('restore.noSlot')
			);
		}
		const placed = installBooksVault(picked.vault);
		if (placed.installed) installed = placed.id;

		app.restore.step = 'unlocking';
		await unlockWith(credential);
		unlocked = true;
		installed = null; // the books are open: the vault stays

		app.restore.step = 'restoring';
		const restored = await /** @type {Session} */ (session).restoreBackup(picked.bytes);
		watchStore();
		// The backup the books came back from: in the list, as if made here, so
		// Einstellungen → Sicherung names it. It cannot carry its own record.
		const settings = /** @type {Session} */ (session).store.settings;
		if (!(await loadBackups(settings)).some((r) => r.itemHash === picked.store.itemHash)) {
			await rememberBackup(settings, {
				at: picked.at,
				cid: picked.cid,
				size: picked.bytes.length,
				status: 'processed',
				itemHash: picked.store.itemHash,
				owner: picked.store.owner,
				sender: picked.store.sender,
				entries: Object.fromEntries(
					restored.manifest.metadata.databases.map((/** @type {any} */ d) => [
						d.collection,
						d.entryCount
					])
				)
			});
		}
		await refresh();
		app.restore.done = { at: picked.at };
		app.status = 'ready';
	} catch (error) {
		console.error('restoring from a backup failed:', error);
		if (installed) uninstallBooksVault(installed);
		// Opened, but not put back: shut again. The vault stays, so trying again
		// opens the same books and merges once more.
		if (unlocked) await lock();
		app.status = 'error';
		app.error = error instanceof Error ? error.message : String(error);
	} finally {
		app.restore.step = '';
	}
}

/**
 * @param {string} [credentialId] one of `listStoredPasskeys()`; the default when omitted
 */
export function unlockStoredPasskey(credentialId) {
	return run(
		async () =>
			credentialId
				? (listStoredPasskeys().find((p) => p.credentialId === credentialId)?.credential ?? null)
				: loadStoredPasskeyCredential(),
		t('onboarding.unlockFailed')
	);
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
	app.keys = [];
	app.keysError = null;
	app.restore = { step: '', found: null, done: null };
	app.backup = {
		address: null,
		owner: null,
		granted: null,
		credits: null,
		history: [],
		step: '',
		progress: null,
		error: null,
		made: null
	};
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
		booksDid: () => session?.booksDid,
		peerId: () => session?.peerId,
		ucepPeerId: () => app.ucep.peerId,
		ucepOnline: () => app.ucep.online,
		secrets: () => {
			const s = session?.secretsForE2E;
			return s
				? {
						databaseKey: hex(s.databaseKey),
						peerKey: hex(s.peerKey),
						ucepSeed: hex(s.ucepSeed),
						booksSecret: hex(s.booksSecret),
						backupKey: hex(s.backupKey),
						alephKey: hex(s.alephKey)
					}
				: null;
		}
	};
}
