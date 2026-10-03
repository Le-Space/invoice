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
//
// Version 2 adds the books' own identity: a random secret every slot opens
// (`booksSecret`, made into a signer with `createSecretSigner`), and, once the
// collections have moved to databases rooted at that identity
// (books-move.js), where they were (`moved`). A version-1 vault is read as it
// is and upgraded on the next unlock.

import {
	createVault,
	openVault,
	addSlot,
	removeSlot,
	replacePayload,
	deriveAesKey,
	slotIdFor
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import { deriveDatabaseKey, deriveDatabaseName, derivePeerKeySeed } from './database-keys.js';

/** Bumping this gives every passkey a new slot key: no slot would open any more. */
export const VAULT_SLOT_INFO = 'invoice/vault-slot/v1';

/** Where the vault records are kept: a JSON array, one record per set of books. */
export const VAULTS_STORAGE_KEY = 'invoice.vaults.v1';

/**
 * The slot ids of passkeys removed from books in this browser. A removed
 * passkey has no slot anywhere, and would otherwise be given books of its own —
 * which for books it made are the very names and key it derives: a stale copy
 * that looks like the real books.
 */
export const REMOVED_SLOTS_STORAGE_KEY = 'invoice.removed-slots.v1';

/** The collections a vault names, as store/repository.js opens them. */
const COLLECTIONS = /** @type {const} */ (['invoices', 'customers', 'settings']);

/**
 * @typedef {object} BooksMove
 * @property {string} at ISO 8601, when the collections moved
 * @property {Record<typeof COLLECTIONS[number], string>} from the old addresses, read-only
 */

/**
 * @typedef {object} BooksValues
 * @property {Uint8Array} dbKey 32 bytes, the AES-GCM key of every collection
 * @property {Record<typeof COLLECTIONS[number], string>} names the OrbitDB names
 * @property {Uint8Array} peerSeed 32 bytes, the UCEP node's key seed
 * @property {Uint8Array} [booksSecret] 32 bytes, the books' identity (version 2)
 * @property {BooksMove} [moved] where the collections were before they moved (version 2)
 */

/** A passkey that was removed from the books in this browser: it opens nothing here. */
export class RemovedPasskeyError extends Error {
	constructor() {
		super(
			'Dieser Schlüssel wurde aus den Büchern entfernt und öffnet sie nicht mehr. Bitte mit einem eingetragenen Schlüssel entsperren.'
		);
		this.name = 'RemovedPasskeyError';
	}
}

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
			version: values.booksSecret ? 2 : 1,
			dbKey: toHex(values.dbKey),
			names: values.names,
			peerSeed: toHex(values.peerSeed),
			...(values.booksSecret ? { booksSecret: toHex(values.booksSecret) } : {}),
			...(values.moved ? { moved: values.moved } : {})
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
	if (parsed?.version !== 1 && parsed?.version !== 2) {
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
	/** @type {BooksValues} */
	const values = {
		dbKey: fromHex(parsed.dbKey, 32),
		names: /** @type {BooksValues['names']} */ (names),
		peerSeed: fromHex(parsed.peerSeed, 32)
	};
	if (parsed.version === 2) {
		values.booksSecret = fromHex(parsed.booksSecret, 32);
		if (parsed.moved !== undefined) values.moved = readMove(parsed.moved);
	}
	return values;
}

/** @param {any} moved @returns {BooksMove} */
function readMove(moved) {
	if (typeof moved?.at !== 'string' || typeof moved?.from !== 'object' || !moved.from) {
		throw new VaultStorageError('The vault records a move it cannot read.');
	}
	/** @type {Record<string, string>} */
	const from = {};
	for (const collection of COLLECTIONS) {
		if (typeof moved.from[collection] !== 'string') {
			throw new VaultStorageError(`The vault records no old address for ${collection}.`);
		}
		from[collection] = moved.from[collection];
	}
	return { at: moved.at, from: /** @type {BooksMove['from']} */ (from) };
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
 * Put a changed record in place of the one with the same id.
 *
 * @param {Storage} storage
 * @param {any} vault
 */
function replaceVault(storage, vault) {
	const vaults = loadVaults(storage);
	const at = vaults.findIndex((candidate) => candidate?.id === vault.id);
	if (at === -1) throw new VaultStorageError('The vault is no longer in this browser.');
	vaults[at] = vault;
	saveVaults(storage, vaults);
}

/**
 * The same books with new values — the same vault key and slots, a new
 * payload — written in place of the old record.
 *
 * @param {{ vault: any, vaultKey: Uint8Array }} opened from `openBooksVault`
 * @param {BooksValues} values
 * @param {Storage} [storage]
 * @returns {Promise<{ values: BooksValues, vault: any, vaultKey: Uint8Array }>}
 */
export async function updateBooksVault({ vault, vaultKey }, values, storage = localStorage) {
	const next = await replacePayload(vault, vaultKey, encodeValues(values));
	replaceVault(storage, next);
	return { values, vault: next, vaultKey };
}

/**
 * Give version-1 books their own identity: a random secret, kept in the vault
 * and so the same for every slot. Books that have one keep it.
 *
 * @param {{ values: BooksValues, vault: any, vaultKey: Uint8Array }} opened
 * @param {Storage} [storage]
 * @returns {Promise<{ values: BooksValues, vault: any, vaultKey: Uint8Array }>}
 */
export async function ensureBooksSecret(opened, storage = localStorage) {
	if (opened.values.booksSecret) return opened;
	return updateBooksVault(
		opened,
		{ ...opened.values, booksSecret: crypto.getRandomValues(new Uint8Array(32)) },
		storage
	);
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
 * @throws {RemovedPasskeyError} when this passkey was removed from the books here
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

	if (removedSlots(storage).includes(kid)) throw new RemovedPasskeyError();

	const values = await deriveBooksValues(prfOutput);
	const made = await createVault(encodeValues(values), slot);
	saveVaults(storage, [...vaults, made.vault]);
	return { values, vault: made.vault, vaultKey: made.vaultKey, created: true };
}

/**
 * One more passkey for these books: its slot, sealed under the key its own PRF
 * output derives. Needs the vault open — the books unlocked — and the new
 * passkey's answer, so both keys are at hand at once.
 *
 * @param {{ values: BooksValues, vault: any, vaultKey: Uint8Array }} opened
 * @param {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array }} key the new passkey
 * @param {Storage} [storage]
 * @returns {Promise<{ values: BooksValues, vault: any, vaultKey: Uint8Array }>}
 * @throws {import('@le-space/orbitdb-identity-provider-webauthn-did').VaultError}
 *   `VAULT_SLOT_EXISTS` when the passkey has one already
 */
export async function addBooksSlot(opened, { prfOutput, rawCredentialId }, storage = localStorage) {
	const vault = await addSlot(opened.vault, opened.vaultKey, {
		slotKey: await deriveAesKey(prfOutput, VAULT_SLOT_INFO),
		rawCredentialId
	});
	replaceVault(storage, vault);
	// A passkey removed once and added again opens the books again.
	const kid = await slotIdFor(rawCredentialId);
	const removed = removedSlots(storage);
	if (removed.includes(kid)) {
		storage.setItem(
			REMOVED_SLOTS_STORAGE_KEY,
			JSON.stringify(removed.filter((other) => other !== kid))
		);
	}
	return { ...opened, vault };
}

/**
 * A passkey no longer opens these books.
 *
 * It does not undo what that passkey already opened: it knew the vault key,
 * and an older copy of the record still has its slot. Against a stolen key
 * the books have to move again, under a new secret.
 *
 * @param {{ values: BooksValues, vault: any, vaultKey: Uint8Array }} opened
 * @param {Uint8Array} rawCredentialId the passkey to remove
 * @param {Storage} [storage]
 * @returns {Promise<{ values: BooksValues, vault: any, vaultKey: Uint8Array }>}
 * @throws {import('@le-space/orbitdb-identity-provider-webauthn-did').VaultError}
 *   `VAULT_LAST_SLOT` for the only one, `VAULT_NO_SLOT` for one that has none
 */
export async function removeBooksSlot(opened, rawCredentialId, storage = localStorage) {
	const vault = await removeSlot(opened.vault, rawCredentialId);
	replaceVault(storage, vault);
	const kid = await slotIdFor(rawCredentialId);
	storage.setItem(REMOVED_SLOTS_STORAGE_KEY, JSON.stringify([...removedSlots(storage), kid]));
	return { ...opened, vault };
}

/** @param {Storage} storage @returns {string[]} */
function removedSlots(storage) {
	try {
		const parsed = JSON.parse(storage.getItem(REMOVED_SLOTS_STORAGE_KEY) ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((kid) => typeof kid === 'string') : [];
	} catch {
		return [];
	}
}

/**
 * The slot ids of the books' passkeys: SHA-256 of each raw credential id.
 *
 * @param {{ vault: any }} opened
 * @returns {string[]}
 */
export function booksSlotIds(opened) {
	return opened.vault.slots.map((/** @type {any} */ slot) => slot.kid);
}
