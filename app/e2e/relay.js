// A circuit relay on this machine for the browser specs: what the Le-Space
// relay (orbitdb-relay) is in production — WebSocket in, circuit relay v2 —
// with a key derived from a fixed seed, so the app can be built with its
// address before it runs.
import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify, identifyPush } from '@libp2p/identify';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';

export const RELAY_PORT = Number(process.env.E2E_RELAY_PORT || 4492);
const SEED = new Uint8Array(32).fill(42);

export async function relayKey() {
	return generateKeyPairFromSeed('Ed25519', SEED);
}

/** The relay's multiaddr, as the app is built with it. */
export async function relayAddr() {
	const peerId = peerIdFromPrivateKey(await relayKey());
	return `/ip4/127.0.0.1/tcp/${RELAY_PORT}/ws/p2p/${peerId}`;
}

export async function startRelay() {
	return createLibp2p({
		privateKey: await relayKey(),
		addresses: { listen: [`/ip4/127.0.0.1/tcp/${RELAY_PORT}/ws`] },
		transports: [webSockets()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: {
			identify: identify(),
			relay: circuitRelayServer({ reservations: { maxReservations: 32 } })
		}
	});
}

/**
 * A node as a consumer uses it: it reaches browsers through the relay.
 *
 * @param {string} relay
 */
export async function startConsumerNode(relay) {
	const node = await createLibp2p({
		addresses: { listen: [] },
		transports: [webSockets(), circuitRelayTransport()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		connectionGater: { denyDialMultiaddr: () => false },
		services: { identify: identify(), identifyPush: identifyPush() }
	});
	const { multiaddr } = await import('@multiformats/multiaddr');
	await node.dial(multiaddr(relay));
	return node;
}
