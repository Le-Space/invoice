// Ported from Le-Space/belege (app/src/lib/node.js) at 9a40d22 and published here
// under the MIT license by its author. Changed: Belege's names (storage paths,
// key info strings, database names) are the invoice app's; no receipt files (blob store) and no legacy keystore to forget.
// Ported from Le-Space/simple-todo apps/invoice01 (src/lib/p2p.js) at 56647d5,
// the parts that build Helia and OrbitDB for a passkey identity:
// `createPersistentStores`, `createHeliaWithLibp2p` and the passkey branch of
// `createOrbitDBInstance`.
// Changed: always persistent (no memory mode, so `keepLogsWhereTheChoiceSays`
// has nothing to decide and is not needed); no network (see network.js); no
// todo list, delegation, relay or diagnostics code. The database key, the
// names and the UCEP seed come from the books' vault (books-vault.js), opened
// with the passkey's PRF output before anything else is. OrbitDB signs as the
// books' own identity, an Ed25519 signer from the vault's secret, in a
// session-only keystore (session-identities.js); the collections moved to
// databases rooted at that identity (books-move.js). The libp2p peer key is
// ephemeral (network.js): no private key is kept in IndexedDB or localStorage.

import { createHeliaLight } from 'helia';
import { withBitswap } from '@helia/bitswap';
import { withLibp2p } from '@helia/libp2p';
import { LevelBlockstore } from 'blockstore-level';
import { LevelDatastore } from 'datastore-level';
import { createOrbitDB, useIdentityProvider } from '@orbitdb/core';
import {
	OrbitDBWebAuthnIdentityProviderFunction,
	WebAuthnDIDProvider,
	createSecretSigner
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import * as dagCbor from '@ipld/dag-cbor';

import { createEphemeralPeerKey, createOfflineLibp2p } from './network.js';
import {
	ensureBackupKeys,
	ensureBooksSecret,
	openBooksVault,
	updateBooksVault
} from './books-vault.js';
import { MOVE_RECORD_KEY, booksAccessController, moveBooks } from './books-move.js';
import { readPrfOutput } from './passkey-identity.js';
import { BOOKS_IDENTITY_INFO, createBooksIdentities } from './session-identities.js';
import { backupCipher } from './backup.js';
import { payloadEncryption } from './entry-encryption.js';
import { openStore } from './store/repository.js';
import SealedDocuments from './store/sealed-documents.js';
import { setSetting } from './store/settings.js';

/**
 * IndexedDB names. Everything the invoice app keeps lives under `invoice/`. There is no
 * keystore among them: see session-identities.js.
 */
export const STORAGE_PATHS = Object.freeze({
	blockstore: 'invoice/helia-blocks',
	datastore: 'invoice/helia-data',
	orbitdb: 'invoice/orbitdb'
});

/**
 * @typedef {object} Session
 * @property {string} did the DID of the passkey that unlocked: who writes
 * @property {string} booksDid the books' own identity, the root writer of every collection
 * @property {string} credentialId the passkey that unlocked, base64url
 * @property {{ values: any, vault: any, vaultKey: Uint8Array }} vault the books' vault, open:
 *   what adding and removing a passkey works on (books-vault.js)
 * @property {Awaited<ReturnType<typeof openStore>>} store reopened after a restore: read it from the session each time
 * @property {(bytes: Uint8Array, options?: { onProgress?: (progress: any) => void }) => Promise<{ manifest: any, databases: { collection?: string, joined: number, entries: number | null }[] }>} restoreBackup
 *   put a backup of these books back in, merging (backup.js, Le-Space/invoice#28)
 * @property {string} identityHash the identity document's hash
 * @property {string} peerId this session's libp2p peer id
 * @property {Uint8Array} ucepSeed the seed of the UCEP node's peer key, from the books' vault
 * @property {() => Promise<void>} stop
 * @property {{ databaseKey: Uint8Array, peerKey: Uint8Array, ucepSeed: Uint8Array, booksSecret: Uint8Array, backupKey: Uint8Array, alephKey: Uint8Array }} [secretsForE2E]
 *   only in E2E builds
 */

/**
 * Unlock the books with a passkey: PRF → key, then Helia, OrbitDB and the
 * sealed databases.
 *
 * Prompts: one for the PRF output here, and nothing else: the books' identity
 * is a signer from the vault, which asks no passkey. A new passkey adds its
 * `create`, a restore its two touches.
 *
 * The first unlock after the books got their own identity moves the
 * collections to databases rooted at it (books-move.js) before anything is
 * shown; the old ones stay, read-only.
 *
 * @param {any} credential from passkey-identity.js
 * @returns {Promise<Session>}
 * @throws {import('./passkey-identity.js').PrfUnavailableError} before anything is opened
 */
export async function startSession(credential) {
	// First, and before anything is opened: without PRF there is no key, and
	// without a key nothing is read or written. No plaintext fallback.
	const prfOutput = await readPrfOutput(credential);
	// The key, the names and the UCEP seed come from the books' vault, which any
	// passkey with a slot opens. The first unlock fills it with what this passkey
	// derives, so books made before the vault are found where they are.
	// Books from before version 2 get their own identity's secret here, and
	// books from before version 3 the keys a backup needs (Le-Space/invoice#28).
	let opened = await ensureBackupKeys(
		await ensureBooksSecret(
			await openBooksVault({ prfOutput, rawCredentialId: credential.rawCredentialId })
		)
	);
	const { values } = opened;
	const encryptionKey = values.dbKey;
	// The UCEP node's key (ucep/net.js): the same peer id on every unlock.
	const ucepSeed = values.peerSeed;

	const blockstore = new LevelBlockstore(STORAGE_PATHS.blockstore);
	const datastore = new LevelDatastore(STORAGE_PATHS.datastore);
	const peerKey = await createEphemeralPeerKey();
	const libp2p = await createOfflineLibp2p(peerKey);
	const helia = await withBitswap(
		withLibp2p(createHeliaLight({ codecs: [dagCbor], blockstore, datastore }), libp2p)
	).start();

	try {
		try {
			useIdentityProvider(OrbitDBWebAuthnIdentityProviderFunction);
		} catch {
			// Already registered.
		}

		// Who unlocked: their DID goes into `author` and keys the invoice number
		// circle, so two keys never count in one circle.
		const did = credential.did ?? (await WebAuthnDIDProvider.createDID(credential));

		// The books' identity: the vault's secret as an Ed25519 signer, the same
		// for every slot, and the root of every collection's access controller.
		const books = await createSecretSigner(/** @type {Uint8Array} */ (values.booksSecret), {
			info: BOOKS_IDENTITY_INFO
		});
		const identities = await createBooksIdentities(helia, books);
		const identity = await identities.createIdentity({
			provider: OrbitDBWebAuthnIdentityProviderFunction({ signer: books })
		});
		const orbitdb = await createOrbitDB({
			ipfs: helia,
			// @ts-expect-error `identities` is a documented option the bundled types omit
			identities,
			identity,
			directory: STORAGE_PATHS.orbitdb
		});

		let move = null;
		if (!values.moved) {
			// The collections were written by the passkey that made the books, under
			// its own access controller. That passkey is the only slot until a
			// second key is added, and adding one waits for the move.
			if (opened.vault.slots.length !== 1) {
				throw new Error(
					'Die Bücher sind noch nicht umgezogen, haben aber schon mehrere Schlüssel; ' +
						'bitte mit dem Schlüssel entsperren, mit dem sie angelegt wurden.'
				);
			}
			move = await moveBooks({
				orbitdb,
				names: values.names,
				encryptionKey,
				formerWriter: did
			});
		}

		const open = () =>
			openStore({
				orbitdb,
				encryptionKey,
				names: values.names,
				author: did,
				accessController: booksAccessController(books.did)
			});
		const store = await open();

		if (move) {
			const at = new Date().toISOString();
			// The record of the move, in the books themselves: what came from where.
			await setSetting(store.settings, MOVE_RECORD_KEY, { at, by: did, ...move });
			// The switch: from now on the vault says the books are at their new place.
			opened = await updateBooksVault(opened, { ...values, moved: { at, from: move.from } });
		}

		/** @type {Session} */
		const session = {
			did,
			booksDid: identity.id,
			credentialId: credential.credentialId,
			vault: opened,
			identityHash: identity.hash,
			peerId: libp2p.peerId.toString(),
			store,
			ucepSeed,
			// Only in E2E builds, so the test can look for these bytes on disk.
			// Written inline so every other build drops it, not just skips it.
			...(import.meta.env.VITE_E2E === 'true'
				? {
						secretsForE2E: {
							databaseKey: encryptionKey,
							peerKey: peerKey.raw,
							ucepSeed,
							booksSecret: /** @type {Uint8Array} */ (values.booksSecret),
							backupKey: /** @type {Uint8Array} */ (values.backupKey),
							alephKey: /** @type {Uint8Array} */ (values.alephKey)
						}
					}
				: {}),
			/**
			 * A backup of these books, put back in: opened with the vault's backup
			 * key, every block back into the blockstore, every collection rejoined
			 * at its address. Merging — what is here stays, nothing is deleted;
			 * a backup of other books is refused. The store is closed and opened
			 * again around it.
			 */
			async restoreBackup(bytes, { onProgress } = {}) {
				const { openAppBackup, restoreAppBackup } = await import(
					'@le-space/orbitdb-storage-bridge/app-backup'
				);
				const { decrypt } = await backupCipher(/** @type {Uint8Array} */ (values.backupKey));
				const backup = await openAppBackup(bytes, { decrypt, app: 'invoice' });
				const addresses = Object.fromEntries(
					Object.entries(session.store.databases()).map(([name, db]) => [
						name,
						db.address.toString()
					])
				);
				await session.store.close();
				try {
					const restored = await restoreAppBackup({
						orbitdb,
						opened: backup,
						addresses,
						open: {
							type: SealedDocuments.type,
							Database: SealedDocuments({ indexBy: 'id' }),
							encryption: await payloadEncryption(encryptionKey),
							AccessController: booksAccessController(books.did)
						},
						onProgress
					});
					return { manifest: backup.manifest, ...restored };
				} finally {
					session.store = await open();
				}
			},
			async stop() {
				await session.store.close();
				await orbitdb.stop();
				await helia.stop();
			}
		};
		return session;
	} catch (error) {
		await helia.stop().catch(() => {});
		throw error;
	}
}
