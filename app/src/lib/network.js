// Ported from Le-Space/belege (app/src/lib/network.js) at 9a40d22 and published here
// under the MIT license by its author. Changed: Belege's names (storage paths,
// key info strings, database names) are the invoice app's.
// The libp2p node under Helia and OrbitDB: prepared for P2P, used offline.
//
// OrbitDB needs a libp2p with a pubsub service (its sync subscribes to one
// topic per database), and Helia needs libp2p to exist. Neither needs a
// connection to anyone for a single device to read and write its own books,
// so this node has no transports, dials nobody, listens nowhere and has no
// peer discovery. Everything stays in this browser.
//
// TODO(p2p): syncing between a person's own devices comes later. Then
// `P2P_ENABLED` becomes a setting and the config comes from
// Le-Space/simple-todo `packages/net/src/libp2p-config.js` (`createLibp2pConfig`):
// WebSockets + WebRTC transports, circuit-relay-v2, the relay bootstrap list,
// pubsub peer discovery, autoNAT and dcutr. Keep gossipsub's
// `runOnLimitedConnection: true` from there — OrbitDB sync over a relayed
// connection depends on it. The data is sealed before it reaches the log, so a
// relay or a peer only ever sees ciphertext.
//
// The peer key: generated here, per session, and handed to libp2p together
// with no datastore, so libp2p and Helia's keychain have nowhere to write it.
// A reload is a new peer id, which costs nothing while nobody dials us. When
// P2P comes, do not switch to `createHelia`'s defaults, which load or create
// the self key in the Helia datastore (`invoice/helia-data`, IndexedDB): keep
// it ephemeral, or, if a stable peer id is wanted, derive it from the passkey's
// PRF answer with HKDF under its own `info` string, as the database key and
// the signing key are. Never persist it.

import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { gossipsub } from '@libp2p/gossipsub';
import { generateKeyPair } from '@libp2p/crypto/keys';

/** Off until device sync exists; see the TODO above. */
export const P2P_ENABLED = false;

/** @typedef {NonNullable<import('libp2p').Libp2pOptions['privateKey']>} PeerKey */

/**
 * A peer key for this session only. It is never written anywhere.
 *
 * @returns {Promise<PeerKey>}
 */
export function createEphemeralPeerKey() {
	return generateKeyPair('Ed25519');
}

/**
 * @param {PeerKey} privateKey from `createEphemeralPeerKey`
 * @returns {import('libp2p').Libp2pOptions<any>}
 */
export function createOfflineLibp2pConfig(privateKey) {
	if (!privateKey) throw new Error('A peer key is required; see createEphemeralPeerKey.');
	return {
		privateKey,
		// No `datastore`: libp2p keeps its peer store and keychain in memory.
		addresses: { listen: [] },
		transports: [],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		peerDiscovery: [],
		services: {
			identify: identify(),
			pubsub: gossipsub({
				emitSelf: false,
				// OrbitDB publishes its heads whether or not anybody listens.
				allowPublishToZeroTopicPeers: true,
				runOnLimitedConnection: true
			})
		}
	};
}

/**
 * @param {PeerKey} [privateKey] defaults to a fresh one
 * @returns {Promise<any>} a started libp2p node that talks to nobody
 */
export async function createOfflineLibp2p(privateKey) {
	if (P2P_ENABLED) {
		throw new Error('P2P is not implemented yet; see the TODO in network.js.');
	}
	return createLibp2p(createOfflineLibp2pConfig(privateKey ?? (await createEphemeralPeerKey())));
}
