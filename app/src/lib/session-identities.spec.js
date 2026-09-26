// Ported from Le-Space/belege (app/src/lib/session-identities.spec.js) at 9a40d22 and published here
// under the MIT license by its author. Changed: Belege's names (storage paths,
// key info strings, database names) are the invoice app's.
import { describe, it, expect, afterAll } from 'vitest';
import { createHeliaLight } from 'helia';
import { withLibp2p } from '@helia/libp2p';
import * as dagCbor from '@ipld/dag-cbor';
import { deriveSigningKeyBytes } from '@le-space/orbitdb-identity-provider-webauthn-did';
import { isSessionKeystore } from '@le-space/orbitdb-identity-provider-webauthn-did/keystore';

import { createOfflineLibp2p } from './network.js';
import { createSessionIdentities } from './session-identities.js';

const did = 'did:key:zDnaeSessionIdentitiesSpec';
const prfOutput = new Uint8Array(32).fill(7);

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

describe('createSessionIdentities', () => {
	it('keeps the signing key in a keystore that lives in memory only', async () => {
		const signingKey = await deriveSigningKeyBytes(prfOutput, did);
		const identities = await createSessionIdentities(await helia(), { did, signingKey });

		expect(isSessionKeystore(identities.keystore)).toBe(true);
		const key = await identities.keystore.getKey(did);
		expect(key?.raw).toEqual(signingKey);
	});

	it('forgets the key between sessions, and a session derives the same one again', async () => {
		const signingKey = await deriveSigningKeyBytes(prfOutput, did);
		const one = await createSessionIdentities(await helia(), { did, signingKey });
		const other = await createSessionIdentities(await helia(), { did: `${did}2`, signingKey });

		// Nothing is shared: each session has only what it was given.
		expect(await other.keystore.getKey(did)).toBeFalsy();
		expect(await deriveSigningKeyBytes(prfOutput, did)).toEqual(signingKey);
		expect((await one.keystore.getKey(did))?.raw).toEqual(signingKey);
	});

	it('refuses a missing DID or a key of the wrong size', async () => {
		const node = await helia();
		await expect(
			createSessionIdentities(node, { did: '', signingKey: new Uint8Array(32) })
		).rejects.toThrow(/DID/);
		await expect(
			createSessionIdentities(node, { did, signingKey: new Uint8Array(16) })
		).rejects.toThrow(/32-byte/);
	});
});
