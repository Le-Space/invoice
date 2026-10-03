// The books' vault: what every passkey of the books' owner has to open alike —
// the database key, the database names and the UCEP peer seed — sealed under a
// random vault key, with one slot per registered passkey
// (`createVault` in @le-space/orbitdb-identity-provider-webauthn-did).
//
// A passkey's PRF output derives different keys for every authenticator, so
// what is only derived can never be opened by a second security key. What is
// in a vault can: the second key gets a slot of its own.
//
// The first step changes nothing on disk. The values in the vault are the ones
// the passkey that made the books derives today (database-keys.js), so the
// first unlock after this update puts exactly those into a vault, under that
// passkey's slot, and every later unlock reads them back from it. A passkey
// without a slot anywhere still gets books of its own, as before: a vault is
// made from what it derives.
//
// The records are kept in this origin's localStorage, like the credential.
// They hold nothing secret in the clear, and they do not travel yet: the
// backup carries them later.

import {
	createVault,
	openVault,
	deriveAesKey,
	slotIdFor
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import { deriveDatabaseKey, deriveDatabaseName, derivePeerKeySeed } from './database-keys.js';

/** Bumping this gives every passkey a new slot key: no slot would open any more. */
export const VAULT_SLOT_INFO = 'invoice/vault-slot/v1';

/** Where the vault records are kept: a JSON array, one record per set of books. */
export const VAULTS_STORAGE_KEY = 'invoice.vaults.v1';

/** The collections a vault names, as store/repository.js opens them. */
const COLLECTIONS = /** @type {const} */ (['invoices', 'customers', 'settings']);

/**
 * @typedef {object} BooksValues
 * @property {Uint8Array} dbKey 32 bytes, the AES-GCM key of every collection
 * @property {Record<typeof COLLECTIONS[number], string>} names the OrbitDB names
 * @property {Uint8Array} peerSeed 32 bytes, the UCEP node's key seed
 */

/** A vault record the app cannot read: it is not replaced, the books stay shut. */
export class VaultStorageError extends Error {
	/** @param {string} message @param {{ cause?: unknown }} [options] */
	constructor(message, options) {
		super(message, options);
		this.name = 'VaultStorageError';
	}
}

/** @param {Uint8Array} bytes */
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** @param {unknown} value @param {number} bytes */
function fromHex(value, bytes) {
	if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${2 * bytes}}$`).test(value)) {
		throw new VaultStorageError('The vault holds a malformed value.');
	}
	return Uint8Array.from(value.match(/../g) ?? [], (h) => parseInt(h, 16));
}

/** @param {BooksValues} values @returns {Uint8Array} */
function encodeValues(values) {
	return new TextEncoder().encode(
		JSON.stringify({
			version: 1,
			dbKey: toHex(values.dbKey),
			names: values.names,
			peerSeed: toHex(values.peerSeed)
		})
	);
}

/** @param {Uint8Array} payload @returns {BooksValues} */
function decodeValues(payload) {
	/** @type {any} */
	let parsed;
	try {
		parsed = JSON.parse(new TextDecoder().decode(payload));
	} catch (error) {
		throw new VaultStorageError('The vault opened, but its content is not readable.', {
			cause: error
		});
	}
	if (parsed?.version !== 1) {
		throw new VaultStorageError(`A vault of version ${parsed?.version} is not readable here.`);
	}
	/** @type {Record<string, string>} */
	const names = {};
	for (const collection of COLLECTIONS) {
		const name = parsed.names?.[collection];
		if (typeof name !== 'string' || !name.startsWith(`invoice.${collection}.`)) {
			throw new VaultStorageError(`The vault names no ${collection} database.`);
		}
		names[collection] = name;
	}
	return {
		dbKey: fromHex(parsed.dbKey, 32),
		names: /** @type {BooksValues['names']} */ (names),
		peerSeed: fromHex(parsed.peerSeed, 32)
	};
}

/**
 * What this passkey derives today: the values books made before the vault
 * existed are found under.
 *
 * @param {Uint8Array} prfOutput
 * @returns {Promise<BooksValues>}
 */
export async function deriveBooksValues(prfOutput) {
	/** @type {Record<string, string>} */
	const names = {};
	for (const collection of COLLECTIONS) {
		names[collection] = await deriveDatabaseName(prfOutput, collection);
	}
	return {
		dbKey: await deriveDatabaseKey(prfOutput),
		names: /** @type {BooksValues['names']} */ (names),
		peerSeed: await derivePeerKeySeed(prfOutput)
	};
}

/**
 * The vault records kept in this origin. An unreadable entry is an error, not
 * an empty list: overwriting it would lose a vault.
 *
 * @param {Storage} storage
 * @returns {any[]}
 */
function loadVaults(storage) {
	const raw = storage.getItem(VAULTS_STORAGE_KEY);
	if (raw === null) return [];
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) return parsed;
	} catch {
		// reported below
	}
	throw new VaultStorageError(
		'Der gespeicherte Tresor ist nicht lesbar; die Bücher bleiben zu, und er wird nicht überschrieben.'
	);
}

/** @param {Storage} storage @param {any[]} vaults */
function saveVaults(storage, vaults) {
	storage.setItem(VAULTS_STORAGE_KEY, JSON.stringify(vaults));
}

/**
 * Open the books of this passkey: the vault that has a slot for it, or — when
 * none has — a new one, filled with what the passkey derives today.
 *
 * No further prompt: the slot key comes from the PRF output already read.
 *
 * @param {object} params
 * @param {Uint8Array} params.prfOutput the passkey's PRF output
 * @param {Uint8Array} params.rawCredentialId the passkey's credential id
 * @param {Storage} [params.storage] localStorage, or a stand-in in tests
 * @returns {Promise<{ values: BooksValues, vault: any, vaultKey: Uint8Array, created: boolean }>}
 * @throws {VaultStorageError} when the stored records cannot be read
 * @throws {import('@le-space/orbitdb-identity-provider-webauthn-did').VaultError}
 *   `VAULT_LOCKED` when this passkey's slot does not open (an altered record)
 */
export async function openBooksVault({ prfOutput, rawCredentialId, storage = localStorage }) {
	const slot = { slotKey: await deriveAesKey(prfOutput, VAULT_SLOT_INFO), rawCredentialId };
	const kid = await slotIdFor(rawCredentialId);
	const vaults = loadVaults(storage);
	const vault = vaults.find((candidate) =>
		candidate?.slots?.some((/** @type {any} */ s) => s?.kid === kid)
	);

	if (vault) {
		const { payload, vaultKey } = await openVault(vault, slot);
		return { values: decodeValues(payload), vault, vaultKey, created: false };
	}

	const values = await deriveBooksValues(prfOutput);
	const made = await createVault(encodeValues(values), slot);
	saveVaults(storage, [...vaults, made.vault]);
	return { values, vault: made.vault, vaultKey: made.vaultKey, created: true };
}
