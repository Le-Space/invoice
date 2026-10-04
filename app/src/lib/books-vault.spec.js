// The books' vault: the first unlock keeps what the passkey derives today, every
// later one reads it back, and a second passkey with a slot gets the same books.
import { describe, expect, it } from 'vitest';
import { addSlot, deriveAesKey, slotIdFor } from '@le-space/orbitdb-identity-provider-webauthn-did';

import {
	RemovedPasskeyError,
	VAULTS_STORAGE_KEY,
	VAULT_SLOT_INFO,
	VaultStorageError,
	addBooksSlot,
	booksHereFor,
	booksSlotIds,
	deriveBooksValues,
	ensureBackupKeys,
	ensureBooksSecret,
	installBooksVault,
	openBooksVault,
	removeBooksSlot,
	uninstallBooksVault,
	updateBooksVault,
	vaultHasSlotFor
} from './books-vault.js';
import { isAlephKey } from './aleph-key.js';
import { deriveDatabaseKey, deriveDatabaseName, derivePeerKeySeed } from './database-keys.js';

/** localStorage, in memory. */
function memoryStorage() {
	const items = new Map();
	return /** @type {Storage} */ ({
		getItem: (key) => (items.has(key) ? items.get(key) : null),
		setItem: (key, value) => void items.set(key, String(value)),
		removeItem: (key) => void items.delete(key),
		clear: () => items.clear(),
		key: (i) => [...items.keys()][i] ?? null,
		get length() {
			return items.size;
		}
	});
}

/** A passkey: its PRF output and its credential id. */
function passkey() {
	return {
		prfOutput: crypto.getRandomValues(new Uint8Array(32)),
		rawCredentialId: crypto.getRandomValues(new Uint8Array(16))
	};
}

/** @param {Uint8Array} bytes */
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('books vault', () => {
	it('the first unlock keeps exactly what this passkey derives today', async () => {
		const storage = memoryStorage();
		const a = passkey();
		const opened = await openBooksVault({ ...a, storage });

		expect(opened.created).toBe(true);
		expect(hex(opened.values.dbKey)).toBe(hex(await deriveDatabaseKey(a.prfOutput)));
		expect(hex(opened.values.peerSeed)).toBe(hex(await derivePeerKeySeed(a.prfOutput)));
		for (const collection of /** @type {const} */ (['invoices', 'customers', 'settings'])) {
			expect(opened.values.names[collection]).toBe(
				await deriveDatabaseName(a.prfOutput, collection)
			);
		}

		const stored = JSON.parse(/** @type {string} */ (storage.getItem(VAULTS_STORAGE_KEY)));
		expect(stored).toHaveLength(1);
		expect(stored[0].slots.map((/** @type {any} */ s) => s.kid)).toEqual([
			await slotIdFor(a.rawCredentialId)
		]);
	});

	it('every later unlock reads the same values back, and makes no second vault', async () => {
		const storage = memoryStorage();
		const a = passkey();
		const first = await openBooksVault({ ...a, storage });
		const again = await openBooksVault({ ...a, storage });

		expect(again.created).toBe(false);
		expect(hex(again.values.dbKey)).toBe(hex(first.values.dbKey));
		expect(again.values.names).toEqual(first.values.names);
		expect(hex(again.values.peerSeed)).toBe(hex(first.values.peerSeed));
		expect(JSON.parse(/** @type {string} */ (storage.getItem(VAULTS_STORAGE_KEY)))).toHaveLength(1);
	});

	it('a second passkey with a slot opens the same books', async () => {
		const storage = memoryStorage();
		const a = passkey();
		const b = passkey();
		const first = await openBooksVault({ ...a, storage });

		// What "add a second key" will do: with the vault open, B gets a slot.
		const withB = await addSlot(first.vault, first.vaultKey, {
			slotKey: await deriveAesKey(b.prfOutput, VAULT_SLOT_INFO),
			rawCredentialId: b.rawCredentialId
		});
		storage.setItem(VAULTS_STORAGE_KEY, JSON.stringify([withB]));

		const viaB = await openBooksVault({ ...b, storage });
		expect(viaB.created).toBe(false);
		expect(hex(viaB.values.dbKey)).toBe(hex(first.values.dbKey));
		expect(viaB.values.names).toEqual(first.values.names);
		expect(hex(viaB.values.peerSeed)).toBe(hex(first.values.peerSeed));
		// B derives other values itself; the vault is what makes them the same.
		expect(hex((await deriveBooksValues(b.prfOutput)).dbKey)).not.toBe(hex(first.values.dbKey));
	});

	it('a passkey without a slot gets books of its own, as before, and the first stay as they are', async () => {
		const storage = memoryStorage();
		const a = passkey();
		const stranger = passkey();
		await openBooksVault({ ...a, storage });
		const before = JSON.parse(/** @type {string} */ (storage.getItem(VAULTS_STORAGE_KEY)))[0];

		const theirs = await openBooksVault({ ...stranger, storage });
		expect(theirs.created).toBe(true);
		expect(hex(theirs.values.dbKey)).toBe(hex(await deriveDatabaseKey(stranger.prfOutput)));

		const after = JSON.parse(/** @type {string} */ (storage.getItem(VAULTS_STORAGE_KEY)));
		expect(after).toHaveLength(2);
		expect(after[0]).toEqual(before);
	});

	it('keeps nothing secret in the clear', async () => {
		const storage = memoryStorage();
		const a = passkey();
		const { values } = await openBooksVault({ ...a, storage });
		const stored = /** @type {string} */ (storage.getItem(VAULTS_STORAGE_KEY));

		for (const secret of [values.dbKey, values.peerSeed, a.prfOutput, a.rawCredentialId]) {
			expect(stored).not.toContain(hex(secret));
		}
		for (const name of Object.values(values.names)) expect(stored).not.toContain(name);
	});

	it('an altered record stays shut, and is not replaced by a new vault', async () => {
		const storage = memoryStorage();
		const a = passkey();
		await openBooksVault({ ...a, storage });
		const [vault] = JSON.parse(/** @type {string} */ (storage.getItem(VAULTS_STORAGE_KEY)));
		const flipped =
			(vault.payload.ciphertext[0] === '0' ? '1' : '0') + vault.payload.ciphertext.slice(1);
		const altered = JSON.stringify([
			{ ...vault, payload: { ...vault.payload, ciphertext: flipped } }
		]);
		storage.setItem(VAULTS_STORAGE_KEY, altered);

		await expect(openBooksVault({ ...a, storage })).rejects.toMatchObject({ code: 'VAULT_LOCKED' });
		expect(storage.getItem(VAULTS_STORAGE_KEY)).toBe(altered);
	});

	it('an unreadable store is reported, not overwritten', async () => {
		const storage = memoryStorage();
		storage.setItem(VAULTS_STORAGE_KEY, '{not json');
		await expect(openBooksVault({ ...passkey(), storage })).rejects.toBeInstanceOf(
			VaultStorageError
		);
		expect(storage.getItem(VAULTS_STORAGE_KEY)).toBe('{not json');
	});

	it('gives books their own identity once: the same secret for every slot, kept on update', async () => {
		const storage = memoryStorage();
		const a = passkey();
		const b = passkey();
		const first = await ensureBooksSecret(await openBooksVault({ ...a, storage }), storage);
		expect(first.values.booksSecret).toHaveLength(32);

		// Again: the secret stays what it is.
		const again = await ensureBooksSecret(await openBooksVault({ ...a, storage }), storage);
		expect(hex(/** @type {Uint8Array} */ (again.values.booksSecret))).toBe(
			hex(/** @type {Uint8Array} */ (first.values.booksSecret))
		);

		// Through another slot: the same secret, so the same books identity.
		const withB = await addSlot(again.vault, again.vaultKey, {
			slotKey: await deriveAesKey(b.prfOutput, VAULT_SLOT_INFO),
			rawCredentialId: b.rawCredentialId
		});
		storage.setItem(VAULTS_STORAGE_KEY, JSON.stringify([withB]));
		const viaB = await openBooksVault({ ...b, storage });
		expect(hex(/** @type {Uint8Array} */ (viaB.values.booksSecret))).toBe(
			hex(/** @type {Uint8Array} */ (first.values.booksSecret))
		);
		expect(hex(viaB.values.dbKey)).toBe(hex(first.values.dbKey));
	});

	it('gives books the keys a backup needs once: the same for every slot, kept, and sealed', async () => {
		const storage = memoryStorage();
		const a = passkey();
		const b = passkey();
		const first = await ensureBackupKeys(
			await ensureBooksSecret(await openBooksVault({ ...a, storage }), storage),
			storage
		);
		const backupKey = /** @type {Uint8Array} */ (first.values.backupKey);
		const alephKey = /** @type {Uint8Array} */ (first.values.alephKey);
		expect(backupKey).toHaveLength(32);
		expect(isAlephKey(alephKey)).toBe(true);
		expect(hex(backupKey)).not.toBe(hex(first.values.dbKey));

		// Again: they stay what they are, and so does the books' identity.
		const again = await ensureBackupKeys(await openBooksVault({ ...a, storage }), storage);
		expect(hex(/** @type {Uint8Array} */ (again.values.backupKey))).toBe(hex(backupKey));
		expect(hex(/** @type {Uint8Array} */ (again.values.alephKey))).toBe(hex(alephKey));
		expect(hex(/** @type {Uint8Array} */ (again.values.booksSecret))).toBe(
			hex(/** @type {Uint8Array} */ (first.values.booksSecret))
		);

		// Through another slot: the same keys, so B can make a backup and open A's.
		await addBooksSlot(again, b, storage);
		const viaB = await openBooksVault({ ...b, storage });
		expect(hex(/** @type {Uint8Array} */ (viaB.values.backupKey))).toBe(hex(backupKey));
		expect(hex(/** @type {Uint8Array} */ (viaB.values.alephKey))).toBe(hex(alephKey));

		// Sealed: neither key is in the stored record as it is.
		const stored = /** @type {string} */ (storage.getItem(VAULTS_STORAGE_KEY));
		for (const secret of [backupKey, alephKey]) expect(stored).not.toContain(hex(secret));
	});

	it('backup keys come only after the books’ identity, and a broken Aleph key is not read', async () => {
		const storage = memoryStorage();
		const a = passkey();
		const opened = await openBooksVault({ ...a, storage });
		await expect(ensureBackupKeys(opened, storage)).rejects.toBeInstanceOf(VaultStorageError);

		const withIdentity = await ensureBooksSecret(opened, storage);
		await updateBooksVault(
			withIdentity,
			{
				...withIdentity.values,
				backupKey: new Uint8Array(32).fill(1),
				alephKey: new Uint8Array(32)
			},
			storage
		);
		await expect(openBooksVault({ ...a, storage })).rejects.toThrow(/Aleph key that is no key/);
	});

	it('records the move in place: the same vault, the same slots, the old addresses', async () => {
		const storage = memoryStorage();
		const a = passkey();
		const opened = await ensureBooksSecret(await openBooksVault({ ...a, storage }), storage);
		const moved = {
			at: '2026-10-03T12:00:00.000Z',
			from: { invoices: '/orbitdb/zdpuA', customers: '/orbitdb/zdpuB', settings: '/orbitdb/zdpuC' }
		};
		await updateBooksVault(opened, { ...opened.values, moved }, storage);

		const stored = JSON.parse(/** @type {string} */ (storage.getItem(VAULTS_STORAGE_KEY)));
		expect(stored).toHaveLength(1);
		expect(stored[0].id).toBe(opened.vault.id);
		expect(stored[0].slots).toEqual(opened.vault.slots);
		const reopened = await openBooksVault({ ...a, storage });
		expect(reopened.values.moved).toEqual(moved);
		expect(hex(/** @type {Uint8Array} */ (reopened.values.booksSecret))).toBe(
			hex(/** @type {Uint8Array} */ (opened.values.booksSecret))
		);
		// The addresses are sealed too: nothing in the stored record names them.
		expect(storage.getItem(VAULTS_STORAGE_KEY)).not.toContain('zdpuA');
	});

	it('adds a passkey, removes another, and a removed one opens nothing here — not even books of its own', async () => {
		const storage = memoryStorage();
		const a = passkey();
		const b = passkey();
		const opened = await ensureBooksSecret(await openBooksVault({ ...a, storage }), storage);

		const withB = await addBooksSlot(opened, b, storage);
		expect(booksSlotIds(withB)).toEqual([
			await slotIdFor(a.rawCredentialId),
			await slotIdFor(b.rawCredentialId)
		]);
		const viaB = await openBooksVault({ ...b, storage });
		expect(hex(viaB.values.dbKey)).toBe(hex(opened.values.dbKey));

		const withoutA = await removeBooksSlot(viaB, a.rawCredentialId, storage);
		expect(booksSlotIds(withoutA)).toEqual([await slotIdFor(b.rawCredentialId)]);
		await expect(openBooksVault({ ...a, storage })).rejects.toBeInstanceOf(RemovedPasskeyError);
		expect(JSON.parse(/** @type {string} */ (storage.getItem(VAULTS_STORAGE_KEY)))).toHaveLength(1);

		// The last one stays.
		await expect(removeBooksSlot(withoutA, b.rawCredentialId, storage)).rejects.toMatchObject({
			code: 'VAULT_LAST_SLOT'
		});

		// Added again, A opens the same books again.
		await addBooksSlot(await openBooksVault({ ...b, storage }), a, storage);
		const backA = await openBooksVault({ ...a, storage });
		expect(hex(backA.values.dbKey)).toBe(hex(opened.values.dbKey));
	});

	it('a vault from a backup goes into an empty browser, and its passkeys open the books there', async () => {
		const here = memoryStorage();
		const a = passkey();
		const b = passkey();
		const made = await addBooksSlot(
			await ensureBackupKeys(
				await ensureBooksSecret(await openBooksVault({ ...a, storage: here }), here),
				here
			),
			b,
			here
		);
		const record = JSON.parse(JSON.stringify(made.vault));

		// An empty browser: no books for B, not removed either.
		const empty = memoryStorage();
		expect(await booksHereFor(b.rawCredentialId, empty)).toEqual({ slot: false, removed: false });
		expect(await vaultHasSlotFor(record, b.rawCredentialId)).toBe(true);
		expect(await vaultHasSlotFor(record, passkey().rawCredentialId)).toBe(false);

		// Fields beyond the vault's own are not kept.
		expect(installBooksVault({ ...record, note: 'from somewhere' }, empty)).toEqual({
			installed: true,
			id: record.id
		});
		expect(JSON.parse(/** @type {string} */ (empty.getItem(VAULTS_STORAGE_KEY)))[0]).toEqual(
			record
		);
		expect(await booksHereFor(b.rawCredentialId, empty)).toEqual({ slot: true, removed: false });

		// B opens the same books there: the same key, names and backup keys.
		const viaB = await openBooksVault({ ...b, storage: empty });
		expect(viaB.created).toBe(false);
		expect(hex(viaB.values.dbKey)).toBe(hex(made.values.dbKey));
		expect(viaB.values.names).toEqual(made.values.names);
		expect(hex(/** @type {Uint8Array} */ (viaB.values.backupKey))).toBe(
			hex(/** @type {Uint8Array} */ (made.values.backupKey))
		);

		// The same vault again stays as it is here; taking it out leaves nothing.
		expect(installBooksVault(record, empty)).toEqual({ installed: false, id: record.id });
		uninstallBooksVault(record.id, empty);
		expect(JSON.parse(/** @type {string} */ (empty.getItem(VAULTS_STORAGE_KEY)))).toEqual([]);
	});

	it('a backup’s vault is refused when it is no vault, or when its passkey opens other books here', async () => {
		const here = memoryStorage();
		const a = passkey();
		const ours = await openBooksVault({ ...a, storage: here });
		const record = JSON.parse(JSON.stringify(ours.vault));
		for (const broken of [
			null,
			{ ...record, version: 2 },
			{ ...record, id: 'zz' },
			{ ...record, slots: [] },
			{ ...record, slots: [{ ...record.slots[0], kid: 'abc' }] },
			{ ...record, payload: { iv: record.payload.iv } }
		]) {
			expect(() => installBooksVault(broken, memoryStorage())).toThrow(VaultStorageError);
		}

		// Other books in this browser that A opens already: a backup with A's slot is not put in.
		const other = memoryStorage();
		await openBooksVault({ ...a, storage: other });
		const otherBooks = JSON.parse(/** @type {string} */ (other.getItem(VAULTS_STORAGE_KEY)))[0];
		expect(otherBooks.id).not.toBe(record.id);
		expect(() => installBooksVault(otherBooks, here)).toThrow(/schon andere Bücher/);

		// A passkey removed here is reported as removed, not as having no books.
		const b = passkey();
		const withB = await addBooksSlot(ours, b, here);
		await removeBooksSlot(withB, b.rawCredentialId, here);
		expect(await booksHereFor(b.rawCredentialId, here)).toEqual({ slot: false, removed: true });
	});
});
