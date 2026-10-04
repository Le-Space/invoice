// Backing the books up on Aleph, from the browser alone (Le-Space/invoice#28).
//
// One file per backup, the storage bridge's application backup (`OSBA`,
// @le-space/orbitdb-storage-bridge/app-backup):
//   - in front, read without a key, the books' vault as this browser keeps it
//     (books-vault.js): one sealed slot per registered passkey, the values
//     sealed under the vault key. Any registered passkey finds the keys to the
//     rest there, on any device;
//   - behind it, the three collections block by block (`bundleDatabases`),
//     sealed with the vault's `backupKey` (AES-GCM).
//
// The browser uploads it to Aleph's IPFS host, which needs no key, and signs
// the STORE message that has Aleph keep it, with the vault's `alephKey`, for
// the paying account (`owner`) and paid in credits. That account is belege's
// bridge account. It lets this key send STORE on INVOICE-BACKUP once
// (`pnpm setup:aleph -- --authorize <address> --channel INVOICE-BACKUP`,
// Le-Space/belege#263), and Aleph charges it, never this key (measured
// 2026-10-03, NiKrause/orbitdb-storage-bridge#147). The bridge does not have to
// run for a backup.
//
// What leaves: the sealed file to Aleph's IPFS host (Aleph sees its size and
// this device's IP address, not what is in it); the STORE message with this
// key's address, the account's and the file's id to the Aleph API; and, to
// show the state, reads of the account's grants and credits there.
//
// The storage bridge and the curve code are loaded only here, when a backup is
// made or checked, not with the page.

import { getSetting, setSetting } from './store/settings.js';

/** The Aleph channel invoice's backups are kept on, and found by. */
export const BACKUP_CHANNEL = 'INVOICE-BACKUP';
/** The settings record with the paying account's address. */
export const BACKUP_OWNER_SETTING = 'backup/owner';
/** The settings record with the backups made, newest first. */
export const BACKUPS_SETTING = 'backup/history';
/** The newest this many are kept in the list; older backups stay where they are. */
export const KEEP = 50;

/** In E2E builds only: where a fake Aleph runs, set by the test. */
export const E2E_ALEPH_URL_KEY = 'invoice.e2e.alephUrl';

const ALEPH = Object.freeze({
	ingestUrl: 'https://ipfs.aleph.cloud/api/v0/add',
	apiHost: 'https://api2.aleph.im',
	gateways: ['https://ipfs.aleph.cloud/ipfs']
});

/** @typedef {{ ingestUrl: string, apiHost: string, gateways: string[] }} AlephEndpoints */

/** @returns {AlephEndpoints} */
export function alephEndpoints() {
	// Written inline so every other build drops it.
	if (import.meta.env.VITE_E2E === 'true') {
		const base = globalThis.localStorage?.getItem(E2E_ALEPH_URL_KEY);
		if (base) return { ingestUrl: `${base}/api/v0/add`, apiHost: base, gateways: [`${base}/ipfs`] };
	}
	return ALEPH;
}

/**
 * When a backup is made, and the name its file gets at Aleph's IPFS host.
 *
 * @param {Date} [at]
 */
export function backupMoment(at = new Date()) {
	return {
		at,
		name: `invoice-${at.toISOString().slice(0, 16).replace('T', '-').replace(':', '')}.backup`
	};
}

/** The app's release, as the build names it; written into each backup. */
export const appRelease = () =>
	typeof __BUILD_RELEASE__ === 'string' && __BUILD_RELEASE__ ? __BUILD_RELEASE__ : 'dev';

/** @param {unknown} value */
export const isAddress = (value) =>
	typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value.trim());

/**
 * @typedef {object} BackupRecord
 * @property {string} at ISO 8601
 * @property {string} cid what Aleph's IPFS host answered: the id to fetch the file by
 * @property {number} size bytes, sealed
 * @property {string} status Aleph's: `processed` is kept
 * @property {string} itemHash the STORE message
 * @property {string} owner the paying account
 * @property {string} sender this key's address
 * @property {Record<string, number>} entries log entries per collection
 */

/** @param {any} settings @returns {Promise<BackupRecord[]>} */
export async function loadBackups(settings) {
	const list = await getSetting(settings, BACKUPS_SETTING);
	return Array.isArray(list) ? list : [];
}

/** @param {any} settings @param {BackupRecord} record @returns {Promise<BackupRecord[]>} */
export async function rememberBackup(settings, record) {
	const list = [record, ...(await loadBackups(settings))].slice(0, KEEP);
	await setSetting(settings, BACKUPS_SETTING, list);
	return list;
}

/** @param {any} settings @returns {Promise<string | null>} */
export async function loadBackupOwner(settings) {
	const owner = await getSetting(settings, BACKUP_OWNER_SETTING);
	return isAddress(owner) ? owner : null;
}

/**
 * Keep the paying account's address, in EIP-55 form (Aleph keys accounts by it).
 *
 * @param {any} settings
 * @param {string} address
 * @returns {Promise<string>} as kept
 */
export async function saveBackupOwner(settings, address) {
	if (!isAddress(address)) throw new TypeError('not an address');
	const { toChecksumAddress } = await import('./aleph-signer.js');
	const owner = toChecksumAddress(address.trim());
	await setSetting(settings, BACKUP_OWNER_SETTING, owner);
	return owner;
}

/** This key's address: what the grant names. @param {Uint8Array} alephKey */
export async function backupAddressOf(alephKey) {
	const { alephAddressOf } = await import('./aleph-signer.js');
	return alephAddressOf(alephKey);
}

/**
 * Has the paying account let this key send STORE on INVOICE-BACKUP? Read from
 * its `security` aggregate on Aleph, which anyone may read.
 *
 * @param {{ owner: string, address: string, endpoints?: AlephEndpoints, fetch?: typeof fetch }} params
 * @returns {Promise<boolean>}
 */
export async function isGranted({ owner, address, endpoints = alephEndpoints(), fetch: f }) {
	const { createAlephAuthorizer } = await import(
		'@le-space/orbitdb-storage-bridge/backends/aleph-pin'
	);
	const authorizer = createAlephAuthorizer({
		owner,
		// Only read here; the account's key is belege's bridge's, never this page's.
		sign: async () => {
			throw new Error('reading only');
		},
		apiHost: endpoints.apiHost,
		...(f ? { fetch: f } : {})
	});
	const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) =>
		String(a).toLowerCase() === String(b).toLowerCase();
	return (await authorizer.read()).some(
		(grant) =>
			same(grant.address, address) &&
			(!grant.types?.length || grant.types.includes('STORE')) &&
			(!grant.channels?.length || grant.channels.includes(BACKUP_CHANNEL))
	);
}

/**
 * The paying account's credits, or null when Aleph does not say.
 *
 * @param {{ owner: string, endpoints?: AlephEndpoints, fetch?: typeof fetch }} params
 * @returns {Promise<number | null>}
 */
export async function creditsOf({ owner, endpoints = alephEndpoints(), fetch: f = fetch }) {
	const response = await f(`${endpoints.apiHost}/api/v0/addresses/${owner}/balance`);
	if (!response.ok) return null;
	const body = await response.json().catch(() => ({}));
	return Number.isFinite(body?.credit_balance) ? body.credit_balance : null;
}

/**
 * AES-GCM with the vault's backup key, in the shape the storage bridge takes.
 *
 * @param {Uint8Array} backupKey
 */
export async function backupCipher(backupKey) {
	const key = await crypto.subtle.importKey(
		'raw',
		/** @type {BufferSource} */ (backupKey),
		'AES-GCM',
		false,
		['encrypt', 'decrypt']
	);
	return {
		/** @param {Uint8Array} plaintext */
		encrypt: async (plaintext) => {
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const ciphertext = new Uint8Array(
				await crypto.subtle.encrypt(
					{ name: 'AES-GCM', iv },
					key,
					/** @type {BufferSource} */ (plaintext)
				)
			);
			return { ciphertext, iv };
		},
		/** @param {Uint8Array} ciphertext @param {Uint8Array} iv */
		decrypt: async (ciphertext, iv) =>
			new Uint8Array(
				await crypto.subtle.decrypt(
					{ name: 'AES-GCM', iv: /** @type {BufferSource} */ (iv) },
					key,
					/** @type {BufferSource} */ (ciphertext)
				)
			)
	};
}

/**
 * The backup file: the vault in front, the collections sealed behind it.
 *
 * @param {object} params
 * @param {Record<string, any>} params.databases the store's databases, by collection
 * @param {any} params.vault the vault record, as books-vault.js keeps it
 * @param {Uint8Array} params.backupKey from the vault
 * @param {string} [params.appVersion]
 * @param {() => Date} [params.now]
 * @param {(progress: any) => void} [params.onProgress]
 * @returns {Promise<{ bytes: Uint8Array, manifest: any, blocks: number, carBytes: number }>}
 */
export async function buildBackup({ databases, vault, backupKey, appVersion, now, onProgress }) {
	const { buildAppBackup } = await import('@le-space/orbitdb-storage-bridge/app-backup');
	const { encrypt } = await backupCipher(backupKey);
	return buildAppBackup({
		app: 'invoice',
		databases,
		encrypt,
		header: new TextEncoder().encode(JSON.stringify(vault)),
		appVersion,
		now,
		onProgress
	});
}

/** Aleph did not keep a backup; `reason` says why, when Aleph said. */
export class BackupRefusedError extends Error {
	/** @param {'credits' | 'rejected'} kind @param {Record<string, unknown>} reason */
	constructor(kind, reason) {
		super(
			kind === 'credits'
				? 'Aleph wants more credits for a day of this backup.'
				: 'Aleph did not keep the backup.'
		);
		this.name = 'BackupRefusedError';
		this.kind = kind;
		this.reason = reason;
	}
}

/**
 * Upload the file and have Aleph keep it: a STORE signed with this key for the
 * paying account, paid in credits, followed until Aleph has decided.
 *
 * @param {object} params
 * @param {Uint8Array} params.bytes the backup file
 * @param {string} params.name the file's name at Aleph's IPFS host
 * @param {string} params.owner the paying account
 * @param {Uint8Array} params.alephKey from the vault
 * @param {AlephEndpoints} [params.endpoints]
 * @param {typeof fetch} [params.fetch]
 * @param {{ timeout?: number, interval?: number }} [params.settle]
 * @param {(step: 'uploading' | 'keeping') => void} [params.onStep]
 * @returns {Promise<{ cid: string, itemHash: string, status: string, sender: string }>}
 * @throws {BackupRefusedError} when Aleph refuses to keep it
 */
export async function keepBackup({
	bytes,
	name,
	owner,
	alephKey,
	endpoints = alephEndpoints(),
	fetch: f,
	settle = {},
	onStep
}) {
	const [
		{ createAlephBackend },
		{ createAlephPin, waitForMessage },
		{ alephAddressOf, alephSign }
	] = await Promise.all([
		import('@le-space/orbitdb-storage-bridge/backends/aleph'),
		import('@le-space/orbitdb-storage-bridge/backends/aleph-pin'),
		import('./aleph-signer.js')
	]);
	const withFetch = f ? { fetch: f } : {};

	onStep?.('uploading');
	const handle = await createAlephBackend({
		ingestUrl: endpoints.ingestUrl,
		gateways: endpoints.gateways,
		...withFetch
	}).putBlob(bytes, { name, contentType: 'application/octet-stream' });

	onStep?.('keeping');
	const sender = alephAddressOf(alephKey);
	const sent = await createAlephPin({
		sender,
		owner,
		sign: async (_address, message) => alephSign(alephKey, message),
		apiHost: endpoints.apiHost,
		channel: BACKUP_CHANNEL,
		...withFetch
	})(handle.id);
	/** @type {any} */
	const final =
		sent.status === 'pending'
			? await waitForMessage(sent.itemHash, {
					apiHost: endpoints.apiHost,
					timeout: settle.timeout ?? 60_000,
					interval: settle.interval ?? 2_000,
					...withFetch
				})
			: sent;
	if (final.status === 'rejected') {
		const why = final.details?.errors?.[0];
		if (why && typeof why === 'object' && why.required_credits !== undefined) {
			throw new BackupRefusedError('credits', {
				credits: Math.floor(Number(why.account_credits)),
				required: Math.ceil(Number(why.required_credits))
			});
		}
		throw new BackupRefusedError('rejected', { errorCode: final.errorCode ?? null });
	}
	return { cid: handle.id, itemHash: sent.itemHash, status: final.status, sender };
}
