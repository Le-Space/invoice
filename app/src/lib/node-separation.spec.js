// The books never reach the network: OrbitDB and Helia run on a libp2p node
// that has no transport, and the one node that does go online (UCEP, through
// a relay) has nothing OrbitDB could replicate over. A relay with an OrbitDB
// of its own therefore finds no database to subscribe to and no block to
// fetch. The entries are sealed (`data` encryption only, no `replication`
// layer), so this separation is what keeps them off any relay; these tests
// fail when it changes. See AGENTS.md, "The books stay off the network".
import { describe, expect, it } from 'vitest';
import { multiaddr } from '@multiformats/multiaddr';
import {
	createEphemeralPeerKey,
	createOfflineLibp2p,
	createOfflineLibp2pConfig
} from './network.js';
import { ucepLibp2pConfig } from './ucep/net.js';
import nodeSource from './node.js?raw';

describe('the node under OrbitDB', () => {
	it('has no transport, listens nowhere and discovers nobody', async () => {
		const config = createOfflineLibp2pConfig(await createEphemeralPeerKey());
		expect(config.transports).toEqual([]);
		expect(config.addresses?.listen).toEqual([]);
		expect(config.peerDiscovery).toEqual([]);
		expect(Object.keys(config.services ?? {}).sort()).toEqual(['identify', 'pubsub']);
	});

	it('cannot dial anybody, and has no address to be dialled at', async () => {
		const libp2p = await createOfflineLibp2p();
		try {
			expect(libp2p.getMultiaddrs()).toEqual([]);
			await expect(
				libp2p.dial(multiaddr('/ip4/127.0.0.1/tcp/4001/ws'), { signal: AbortSignal.timeout(2000) })
			).rejects.toThrow();
		} finally {
			await libp2p.stop();
		}
	});

	it('is the node Helia and OrbitDB are given, and the UCEP node is not', () => {
		expect(nodeSource).toMatch(/const libp2p = await createOfflineLibp2p\(/);
		expect(nodeSource).toMatch(/withLibp2p\(\s*createHeliaLight\([\s\S]*?\),\s*libp2p\s*\)/);
		expect(nodeSource).not.toMatch(/from '\.\/ucep\/net\.js'/);
	});
});

describe('the UCEP node, the one that goes through a relay', () => {
	it('speaks identify and UCEP only: no gossipsub, no Bitswap, nothing OrbitDB syncs over', async () => {
		const config = ucepLibp2pConfig({
			privateKey: await createEphemeralPeerKey(),
			relays: ['/dns4/relay.example/tcp/443/tls/ws/p2p/12D3KooWExample']
		});
		expect(Object.keys(config.services ?? {}).sort()).toEqual(['identify', 'identifyPush']);
	});
});
