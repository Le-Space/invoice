// Ported from Le-Space/belege (app/src/lib/session-identities.js) at 9a40d22 and
// published here under the MIT license by its author. Changed: no legacy
// keystore to forget, which only a Belege build ever wrote.
// Follows Le-Space/simple-todo apps/privacy01 (src/lib/p2p.js, `createOrbitDBInstance`)
// and packages/todo (src/memory-identities.js) at lespace/main: the OrbitDB
// signing key lives in a keystore that forgets, and is derived again from the
// passkey on every unlock.
// Changed: belege keeps the provider's default secp256k1 signing key (privacy01
// switched to Ed25519), uses the provider's own `createSessionKeystore()`, and
// removes the persistent keystore an earlier build left behind.
// Changed here since the books moved (books-move.js): the identity is no longer
// the passkey's but the books' own, an Ed25519 signer from the vault's secret.
//
// No private key at rest.
//
// OrbitDB signs every entry with whatever `keystore.getKey(identity.id)`
// returns, and its default keystore (`KeyStore({ path })`) writes that key to
// IndexedDB in the clear. Anyone with the browser profile could then sign
// entries as the books without any of their passkeys.
//
// The key does not need to be kept. The books sign as an identity of their
// own (books-move.js): an Ed25519 key derived from a secret in the books'
// vault, which every unlock opens anyway. So the keystore here lives in memory
// only and holds no key at all — it answers for the books' DID with a signer,
// and the key stays inside that signer until the tab closes.

import { Identities } from '@orbitdb/core';
import { createSessionKeystore } from '@le-space/orbitdb-identity-provider-webauthn-did/keystore';

/**
 * The `info` the books' signer is derived under (`createSecretSigner`). Bumping
 * it gives the books another identity, and with it other databases.
 */
export const BOOKS_IDENTITY_INFO = 'invoice/books-identity/v1';

/**
 * Identities on a session-only keystore that signs as the books.
 *
 * @param {any} ipfs a Helia instance
 * @param {{ did: string, type: 'Ed25519', publicKey: Uint8Array, sign: (data: Uint8Array) => Promise<Uint8Array> }} signer
 *   from `createSecretSigner`, with the vault's secret
 * @returns {Promise<any>} OrbitDB Identities
 */
export async function createBooksIdentities(ipfs, signer) {
	// Typed `unknown` by the provider; it is an OrbitDB KeyStore on MemoryStorage.
	const keystore = /** @type {any} */ (await createSessionKeystore({ signer }));
	return Identities({ ipfs, keystore });
}
