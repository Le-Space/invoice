// The libp2p node UCEP runs on (Le-Space/ucep-spec §5.1: browser and mobile
// over a relay).
//
// Apart from the node under Helia and OrbitDB (network.js), which talks to
// nobody: the books never leave this browser, only the commands a paired app
// sends and their answers do. This node dials the relay over a TLS WebSocket,
// takes a reservation there so another browser can reach it through the relay,
// and accepts WebRTC so the two can talk directly once they have met. Noise
// encrypts every connection end to end; the relay sees ciphertext.
//
// Pairing by QR code without any relay is the next step: the alpha module
// @le-space/libp2p-webrtc-qr (Le-Space/simple-todo uses it) exchanges the
// signed WebRTC signaling out of band as QR codes, so two devices in one room
// need no relay at all. Not wired in yet.
//
// Its key is derived from the passkey's PRF answer (database-keys.js,
// `derivePeerKeySeed`), so the peer id a paired app knows stays the same from
// one unlock to the next and on every device the passkey is synced to. It is
// never written anywhere.

import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify, identifyPush } from '@libp2p/identify';
import { webSockets } from '@libp2p/websockets';
import { webRTC } from '@libp2p/webrtc';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';

/**
 * The relay Le-Space/simple-todo uses (its `.env.example`,
 * VITE_RELAY_BOOTSTRAP_ADDR_PROD). Another one is set with VITE_RELAY_ADDRS,
 * comma-separated.
 */
export const DEFAULT_RELAYS = Object.freeze([
	'/dns4/pill-execute-neither-suspect.2n6.me/tcp/443/tls/ws/p2p/12D3KooWSc3Sqr3Q7RGJAFBz5i7WTTC5kzunnm2tvXVcSwTEtUTP'
]);

/**
 * The relays to use: the configured ones, else the default.
 *
 * @param {string | undefined} [configured] comma-separated multiaddrs
 * @returns {string[]}
 */
export function relayAddrs(configured = import.meta.env?.VITE_RELAY_ADDRS) {
	const list = String(configured ?? '')
		.split(',')
		.map((addr) => addr.trim())
		.filter(Boolean);
	return list.length > 0 ? list : [...DEFAULT_RELAYS];
}

/** A relay on this machine, as the browser specs start one. @param {string} addr */
export const isLocal = (addr) => /\/(ip4\/127\.|ip6\/::1\/|dns4\/localhost\/)/.test(addr);

/**
 * @param {{ privateKey: any, relays: string[] }} params
 * @returns {import('libp2p').Libp2pOptions<any>}
 */
export function ucepLibp2pConfig({ privateKey, relays }) {
	return {
		privateKey,
		addresses: {
			// A reservation on each relay, and WebRTC for the direct connection
			// the relay helps to set up.
			listen: [...relays.map((relay) => `${relay}/p2p-circuit`), '/webrtc']
		},
		transports: [webSockets(), webRTC(), circuitRelayTransport()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		connectionManager: {
			// Every connection a paired app opens through the relay comes from
			// the relay's address, and libp2p opens a new one for each call as
			// long as the old one is relayed; the default of five per second
			// from one address refused the sixth.
			inboundConnectionThreshold: 100
		},
		// A browser does not dial private addresses by default; the specs'
		// relay is on 127.0.0.1.
		...(relays.some(isLocal) ? { connectionGater: { denyDialMultiaddr: () => false } } : {}),
		// identify-push: a consumer already connected learns at once that the
		// extension is served (UCEP finds extensions through identify only).
		services: { identify: identify(), identifyPush: identifyPush() }
	};
}

/**
 * Start the node on the key derived from the passkey.
 *
 * @param {{ seed: Uint8Array, relays?: string[] }} params
 */
export async function startUcepNode({ seed, relays = relayAddrs() }) {
	const privateKey = await generateKeyPairFromSeed('Ed25519', seed);
	return createLibp2p(ucepLibp2pConfig({ privateKey, relays }));
}

/**
 * Whether another browser can reach this node: a relay holds a reservation
 * for it, which shows as an address of its own through that relay. Merely
 * being connected to the relay is not enough — a dial before the reservation
 * is refused.
 *
 * @param {any} node
 */
export function reachable(node) {
	return node
		.getMultiaddrs()
		.some((/** @type {any} */ addr) => addr.toString().includes('/p2p-circuit/'));
}
