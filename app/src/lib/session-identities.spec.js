// Ported from Le-Space/belege (app/src/lib/session-identities.spec.js) at 9a40d22 and published here
// under the MIT license by its author. Changed: Belege's names (storage paths,
// key info strings, database names) are the invoice app's. Since the books moved
// (books-move.js), about the books' own signer rather than the passkey's key.
import { describe, it, expect, afterAll } from 'vitest';
import { createHeliaLight } from 'helia';
import { withLibp2p } from '@helia/libp2p';
import * as dagCbor from '@ipld/dag-cbor';
import {
	OrbitDBWebAuthnIdentityProviderFunction,
	createSecretSigner
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import { isSessionKeystore } from '@le-space/orbitdb-identity-provider-webauthn-did/keystore';
import { useIdentityProvider } from '@orbitdb/core';

import { createOfflineLibp2p } from './network.js';
import { BOOKS_IDENTITY_INFO, createBooksIdentities } from './session-identities.js';

const secret = new Uint8Array(32).fill(7);

/** @type {any[]} */
const started = [];
async function helia() {
	const node = await withLibp2p(
		createHeliaLight({ codecs: [dagCbor] }),
		await createOfflineLibp2p()
	).start();
	started.push(node);
	return node;
}

afterAll(async () => {
	await Promise.all(started.map((node) => node.stop()));
});

try {
	useIdentityProvider(OrbitDBWebAuthnIdentityProviderFunction);
} catch {
	// registered by another spec in this worker
}

/** @param {any} identities @param {any} signer */
const identityOf = (identities, signer) =>
	identities.createIdentity({ provider: OrbitDBWebAuthnIdentityProviderFunction({ signer }) });

describe('createBooksIdentities', () => {
	it('signs as the books from a keystore that lives in memory and holds no key', async () => {
		const books = await createSecretSigner(secret, { info: BOOKS_IDENTITY_INFO });
		const identities = await createBooksIdentities(await helia(), books);
		const identity = await identityOf(identities, books);

		expect(isSessionKeystore(identities.keystore)).toBe(true);
		expect(identity.id).toBe(books.did);
		expect(await identities.verifyIdentity(identity)).toBe(true);
		// What the keystore answers with can sign, but carries no private key.
		expect((await identities.keystore.getKey(books.did))?.raw).toBeUndefined();
	});

	it('is the same identity in every session, for every key that opens the vault', async () => {
		const one = await createSecretSigner(secret, { info: BOOKS_IDENTITY_INFO });
		const other = await createSecretSigner(Uint8Array.from(secret), { info: BOOKS_IDENTITY_INFO });
		const first = await identityOf(await createBooksIdentities(await helia(), one), one);
		const second = await identityOf(await createBooksIdentities(await helia(), other), other);

		expect(second.id).toBe(first.id);
		expect(second.hash).toBe(first.hash);
	});

	it('refuses what is not a signer', async () => {
		await expect(
			createBooksIdentities(await helia(), /** @type {any} */ ({ did: 'did:key:z6Mk' }))
		).rejects.toThrow(/signer must be/);
	});
});
