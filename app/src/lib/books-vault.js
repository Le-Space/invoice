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
//
// Version 3 adds what a backup needs (Le-Space/invoice#28), again the same
// for every slot: the key a backup file is sealed with (`backupKey`), and the
// key its STORE message on Aleph is signed with (`alephKey`, aleph-key.js).
// So any registered passkey can make a backup, and open one.
//
// Removing a passkey renews the vault (`renewBooksVault`): a new vault key,
// a new backup key and a new Aleph key, with a slot for every passkey that
// stays. A removed passkey knew the old vault key, and every backup carries
// the vault in front, so a new payload under the old vault key would be no
// secret to it; under a new vault key, the backups made from then on are.
// What it has seen stays seen: the database key, the names and the books'
// identity are not renewed, and older backups still carry its slot.

import {
	VaultError,
	createVault,
	openVault,
	addSlot,
	replacePayload,
	deriveAesKey,
	slotIdFor
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import { isAlephKey, newAlephKey } from './aleph-key.js';
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

/** @typedef {{ slotKey: CryptoKey | Uint8Array, rawCredentialId: Uint8Array }} VaultSlot */

/**
 * @typedef {object} BooksValues
 * @property {Uint8Array} dbKey 32 bytes, the AES-GCM key of every collection
 * @property {Record<typeof COLLECTIONS[number], string>} names the OrbitDB names
 * @property {Uint8Array} peerSeed 32 bytes, the UCEP node's key seed
 * @property {Uint8Array} [booksSecret] 32 bytes, the books' identity (version 2)
 * @property {BooksMove} [moved] where the collections were before they moved (version 2)
 * @property {Uint8Array} [backupKey] 32 bytes, the AES-GCM key a backup file is sealed with (version 3)
 * @property {Uint8Array} [alephKey] 32 bytes, the secp256k1 key a backup's STORE is signed with (version 3)
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
	const backup = Boolean(values.backupKey && values.alephKey);
	if (backup && !values.booksSecret) {
		throw new VaultStorageError('Backup keys come after the books’ own identity, not before it.');
	}
	return new TextEncoder().encode(
		JSON.stringify({
			version: backup ? 3 : values.booksSecret ? 2 : 1,
			dbKey: toHex(values.dbKey),
			names: values.names,
			peerSeed: toHex(values.peerSeed),
			...(values.booksSecret ? { booksSecret: toHex(values.booksSecret) } : {}),
			...(values.moved ? { moved: values.moved } : {}),
			...(backup
				? {
						backupKey: toHex(/** @type {Uint8Array} */ (values.backupKey)),
						alephKey: toHex(/** @type {Uint8Array} */ (values.alephKey))
					}
				: {})
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
	if (![1, 2, 3].includes(parsed?.version)) {
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
	if (parsed.version >= 2) {
		values.booksSecret = fromHex(parsed.booksSecret, 32);
		if (parsed.moved !== undefined) values.moved = readMove(parsed.moved);
	}
	if (parsed.version >= 3) {
		values.backupKey = fromHex(parsed.backupKey, 32);
		values.alephKey = fromHex(parsed.alephKey, 32);
		if (!isAlephKey(values.alephKey)) {
			throw new VaultStorageError('The vault holds an Aleph key that is no key.');
		}
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
 * Put a renewed vault, which has an id of its own, in place of the one it renews.
 *
 * @param {Storage} storage
 * @param {string} id the old record's
 * @param {any} vault
 */
function swapVault(storage, id, vault) {
	const vaults = loadVaults(storage);
	const at = vaults.findIndex((candidate) => candidate?.id === id);
	if (at === -1) throw new VaultStorageError('The vault is no longer in this browser.');
	vaults[at] = vault;
	saveVaults(storage, vaults);
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
 * @template {{ values: BooksValues, vault: any, vaultKey: Uint8Array }} T
 * @param {T} opened from `openBooksVault`
 * @param {BooksValues} values
 * @param {Storage} [storage]
 * @returns {Promise<T>}
 */
export async function updateBooksVault(opened, values, storage = localStorage) {
	const next = await replacePayload(opened.vault, opened.vaultKey, encodeValues(values));
	replaceVault(storage, next);
	return { ...opened, values, vault: next };
}

/**
 * Give version-1 books their own identity: a random secret, kept in the vault
 * and so the same for every slot. Books that have one keep it.
 *
 * @template {{ values: BooksValues, vault: any, vaultKey: Uint8Array }} T
 * @param {T} opened
 * @param {Storage} [storage]
 * @returns {Promise<T>}
 */
export async function ensureBooksSecret(opened, storage = localStorage) {
	if (opened.values.booksSecret) return opened;
	return updateBooksVault(
		opened,
		{ ...opened.values, booksSecret: crypto.getRandomValues(new Uint8Array(32)) },
		storage
	);
}

/** A key to seal a backup file with: 32 random bytes. */
const newBackupKey = () => crypto.getRandomValues(new Uint8Array(32));

/**
 * Give the books what a backup needs: a key to seal the file with and a key
 * to sign its STORE message with, both random, kept in the vault and so the
 * same for every slot. Books that have them keep them; it comes after the
 * books' own identity (`ensureBooksSecret`).
 *
 * @template {{ values: BooksValues, vault: any, vaultKey: Uint8Array }} T
 * @param {T} opened
 * @param {Storage} [storage]
 * @returns {Promise<T>}
 */
export async function ensureBackupKeys(opened, storage = localStorage) {
	if (opened.values.backupKey && opened.values.alephKey) return opened;
	return updateBooksVault(
		opened,
		{
			...opened.values,
			backupKey: newBackupKey(),
			alephKey: newAlephKey()
		},
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
 * @returns {Promise<{ values: BooksValues, vault: any, vaultKey: Uint8Array, created: boolean, slot: VaultSlot }>}
 *   `slot`: the slot key it opened with, kept in memory while the books are
 *   open, so this passkey gets a slot in a renewed vault without another prompt
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
		return { values: decodeValues(payload), vault, vaultKey, created: false, slot };
	}

	if (removedSlots(storage).includes(kid)) throw new RemovedPasskeyError();

	const values = await deriveBooksValues(prfOutput);
	const made = await createVault(encodeValues(values), slot);
	saveVaults(storage, [...vaults, made.vault]);
	return { values, vault: made.vault, vaultKey: made.vaultKey, created: true, slot };
}

/**
 * What a vault record keeps, opened with a slot: e.g. the vault a backup
 * carries in front, which may be older than the one here and hold the
 * backup key that backup was sealed with.
 *
 * @param {unknown} vault
 * @param {VaultSlot} slot from `openBooksVault`
 * @returns {Promise<BooksValues>}
 * @throws {import('@le-space/orbitdb-identity-provider-webauthn-did').VaultError}
 *   `VAULT_NO_SLOT` when this passkey had no slot in it
 */
export async function valuesOfVault(vault, slot) {
	const { payload } = await openVault(vaultRecordOf(vault), slot);
	return decodeValues(payload);
}

/**
 * One more passkey for these books: its slot, sealed under the key its own PRF
 * output derives. Needs the vault open — the books unlocked — and the new
 * passkey's answer, so both keys are at hand at once.
 *
 * @template {{ values: BooksValues, vault: any, vaultKey: Uint8Array }} T
 * @param {T} opened
 * @param {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array }} key the new passkey
 * @param {Storage} [storage]
 * @returns {Promise<T>}
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
 * A passkey no longer opens these books, and what it must not keep is renewed:
 * a new vault — a new vault key, a new backup key, a new Aleph key — with a
 * slot for every passkey that stays. The database key, the names, the peer
 * seed and the books' own identity stay as they are, and with them the books.
 *
 * Every passkey that stays has to answer: the one that opened the vault with
 * the slot key it opened it with (`opened.slot`), every other one with its PRF
 * output here. Each is checked against its old slot before anything changes,
 * so no passkey is left with a slot that does not open.
 *
 * What the removed passkey has seen stays seen: older backups still carry its
 * slot, and the database key and the books' identity are the same. Against a
 * stolen key the books have to move, under new secrets.
 *
 * @param {{ values: BooksValues, vault: any, vaultKey: Uint8Array, slot: VaultSlot }} opened
 * @param {object} change
 * @param {string} change.remove the slot id of the passkey to remove (`slotIdFor`)
 * @param {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array }[]} [change.others]
 *   every other passkey that stays
 * @param {Storage} [storage]
 * @returns {Promise<{ values: BooksValues, vault: any, vaultKey: Uint8Array, slot: VaultSlot }>}
 * @throws {import('@le-space/orbitdb-identity-provider-webauthn-did').VaultError}
 *   `VAULT_LAST_SLOT` for the only one, `VAULT_NO_SLOT` for one that has none,
 *   `VAULT_LOCKED` when another passkey's answer does not open its slot
 */
export async function renewBooksVault(opened, { remove, others = [] }, storage = localStorage) {
	const kids = booksSlotIds(opened);
	if (!kids.includes(remove)) {
		throw new VaultError('This passkey has no slot in the vault', { code: 'VAULT_NO_SLOT' });
	}
	const own = await slotIdFor(opened.slot.rawCredentialId);
	if (remove === own || kids.length === 1) {
		throw new VaultError('The passkey that opened the vault stays in it', {
			code: 'VAULT_LAST_SLOT'
		});
	}
	const slots = [];
	for (const other of others) {
		const slot = {
			slotKey: await deriveAesKey(other.prfOutput, VAULT_SLOT_INFO),
			rawCredentialId: other.rawCredentialId
		};
		// Its answer opens its old slot, or it would get one that never opens.
		await openVault(opened.vault, slot);
		slots.push({ kid: await slotIdFor(other.rawCredentialId), slot });
	}
	const staying = kids.filter((kid) => kid !== remove);
	const answered = new Set([own, ...slots.map((s) => s.kid)]);
	const missing = staying.filter((kid) => !answered.has(kid));
	if (missing.length > 0) {
		throw new VaultStorageError(
			`${missing.length} passkey(s) staying in the books did not answer; the vault was not renewed.`
		);
	}

	// Books that have backup keys get new ones; older books have none to renew.
	const values = opened.values.backupKey
		? { ...opened.values, backupKey: newBackupKey(), alephKey: newAlephKey() }
		: { ...opened.values };
	const made = await createVault(encodeValues(values), opened.slot);
	let vault = made.vault;
	for (const { kid, slot } of slots) {
		if (kid === remove || kid === own) continue;
		vault = await addSlot(vault, made.vaultKey, slot);
	}
	swapVault(storage, opened.vault.id, vault);
	storage.setItem(REMOVED_SLOTS_STORAGE_KEY, JSON.stringify([...removedSlots(storage), remove]));
	return { ...opened, values, vault, vaultKey: made.vaultKey };
}

/**
 * Is there a vault in this browser with a slot for this passkey — and was it
 * removed from books here? Neither means: unlocking would make new books.
 *
 * @param {Uint8Array} rawCredentialId
 * @param {Storage} [storage]
 * @returns {Promise<{ slot: boolean, removed: boolean }>}
 */
export async function booksHereFor(rawCredentialId, storage = localStorage) {
	const kid = await slotIdFor(rawCredentialId);
	return {
		slot: loadVaults(storage).some((vault) =>
			vault?.slots?.some((/** @type {any} */ s) => s?.kid === kid)
		),
		removed: removedSlots(storage).includes(kid)
	};
}

const isHex = (/** @type {unknown} */ value, /** @type {number} */ bytes) =>
	typeof value === 'string' &&
	(bytes ? value.length === 2 * bytes : value.length > 0) &&
	/^[0-9a-f]+$/.test(value);

/**
 * A vault record, as a backup carries it in front: checked for the shape of a
 * version-1 vault and copied field by field, nothing else kept.
 *
 * @param {unknown} value
 * @returns {any}
 * @throws {VaultStorageError}
 */
function vaultRecordOf(value) {
	const vault = /** @type {any} */ (value);
	const ok =
		vault?.version === 1 &&
		vault?.algorithm === 'AES-GCM' &&
		isHex(vault?.id, 16) &&
		isHex(vault?.payload?.iv, 12) &&
		isHex(vault?.payload?.ciphertext, 0) &&
		Array.isArray(vault?.slots) &&
		vault.slots.length > 0 &&
		vault.slots.every(
			(/** @type {any} */ s) => isHex(s?.kid, 32) && isHex(s?.iv, 12) && isHex(s?.ciphertext, 48)
		);
	if (!ok) throw new VaultStorageError('Diese Sicherung enthält keinen lesbaren Tresor.');
	return {
		version: vault.version,
		algorithm: vault.algorithm,
		id: vault.id,
		payload: { iv: vault.payload.iv, ciphertext: vault.payload.ciphertext },
		slots: vault.slots.map((/** @type {any} */ s) => ({
			kid: s.kid,
			iv: s.iv,
			ciphertext: s.ciphertext
		}))
	};
}

/**
 * Does a vault from a backup have a slot for this passkey?
 *
 * @param {unknown} vault
 * @param {Uint8Array} rawCredentialId
 */
export async function vaultHasSlotFor(vault, rawCredentialId) {
	const kid = await slotIdFor(rawCredentialId);
	const slots = /** @type {any} */ (vault)?.slots;
	return Array.isArray(slots) && slots.some((s) => s?.kid === kid);
}

/**
 * Put the vault a backup carries into this browser, so that its passkeys open
 * the books here (Le-Space/invoice#28). A vault with the same id stays as it
 * is: these are the same books, and the one here may be newer. A vault for
 * other books, which one of its passkeys already opens here, is refused.
 *
 * @param {unknown} vault from the backup's header
 * @param {Storage} [storage]
 * @returns {{ installed: boolean, id: string }}
 * @throws {VaultStorageError}
 */
export function installBooksVault(vault, storage = localStorage) {
	const record = vaultRecordOf(vault);
	const vaults = loadVaults(storage);
	if (vaults.some((candidate) => candidate?.id === record.id)) {
		return { installed: false, id: record.id };
	}
	const kids = new Set(record.slots.map((/** @type {any} */ s) => s.kid));
	if (
		vaults.some((candidate) => candidate?.slots?.some((/** @type {any} */ s) => kids.has(s?.kid)))
	) {
		throw new VaultStorageError(
			'Ein Schlüssel dieser Sicherung öffnet in diesem Browser schon andere Bücher; die Sicherung wird nicht eingespielt.'
		);
	}
	saveVaults(storage, [...vaults, record]);
	return { installed: true, id: record.id };
}

/**
 * Take a vault out again that was put here for a restore that did not finish.
 *
 * @param {string} id
 * @param {Storage} [storage]
 */
export function uninstallBooksVault(id, storage = localStorage) {
	saveVaults(
		storage,
		loadVaults(storage).filter((candidate) => candidate?.id !== id)
	);
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
