// Ported from Le-Space/belege (app/src/lib/network.spec.js) at 9a40d22 and published here
// under the MIT license by its author. Changed: Belege's names (storage paths,
// key info strings, database names) are the invoice app's.
import { describe, it, expect } from 'vitest';
import {
	createEphemeralPeerKey,
	createOfflineLibp2p,
	createOfflineLibp2pConfig
} from './network.js';

describe('the offline libp2p node', () => {
	it('gets a new Ed25519 peer key every session', async () => {
		const [one, two] = await Promise.all([createEphemeralPeerKey(), createEphemeralPeerKey()]);
		expect(one.type).toBe('Ed25519');
		expect(one.raw).not.toEqual(two.raw);
	});

	it('is given its key and no datastore, so it has nowhere to keep the key', async () => {
		const privateKey = await createEphemeralPeerKey();
		const config = createOfflineLibp2pConfig(privateKey);
		expect(config.privateKey).toBe(privateKey);
		expect(config).not.toHaveProperty('datastore');
		expect(config.transports).toEqual([]);
		expect(() => createOfflineLibp2pConfig(/** @type {any} */ (undefined))).toThrow(/peer key/);
	});

	it('runs under the key it was given', async () => {
		const privateKey = await createEphemeralPeerKey();
		const libp2p = await createOfflineLibp2p(privateKey);
		try {
			expect(libp2p.peerId.publicKey.equals(privateKey.publicKey)).toBe(true);
		} finally {
			await libp2p.stop();
		}
	});
});
