// Which relays the app uses: the trusted wallets' newest registrations on
// Aleph, else the fallback. Made-up wallets, hosts and peer ids.
import { describe, expect, it } from 'vitest';
import {
	FALLBACK_RELAYS,
	RELAY_REGISTRATION,
	browserDialable,
	relayAddrs,
	relaysFromPosts
} from './net.js';

const A = '0x000000000000000000000000000000000000000a';
const B = '0x000000000000000000000000000000000000000b';
const STRANGER = '0x00000000000000000000000000000000000000ff';
const PEER_A = '12D3KooWAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PEER_B = '12D3KooWBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/** @param {string} sender @param {number} time @param {string[]} multiaddrs @param {string} [registrationId] */
const post = (
	sender,
	time,
	multiaddrs,
	registrationId = String(RELAY_REGISTRATION.registrationId)
) => ({
	sender,
	time,
	item_content: JSON.stringify({ content: { registrationId, multiaddrs } })
});

describe('relaysFromPosts', () => {
	const payload = {
		posts: [
			post(A, 100, [`/dns4/old-a.example.com/tcp/443/tls/ws/p2p/${PEER_A}`]),
			post(A, 200, [
				`/ip4/10.0.0.1/tcp/9092/ws/p2p/${PEER_A}`,
				`/dns6/new-a.example.com/tcp/443/tls/ws/p2p/${PEER_A}`,
				`/dns4/new-a.example.com/tcp/443/tls/ws/p2p/${PEER_A}`
			]),
			post(B, 150, [`/dns4/b.example.com/tcp/443/tls/ws/p2p/${PEER_B}`]),
			post(STRANGER, 300, [`/dns4/evil.example.com/tcp/443/tls/ws/p2p/${PEER_A}`]),
			post(B, 400, [`/dns4/other.example.com/tcp/443/tls/ws/p2p/${PEER_B}`], 'relay:uc-go-peer:x')
		]
	};

	it('takes each trusted wallet’s newest orbitdb-relay registration, one IPv4 name each', () => {
		expect(relaysFromPosts(payload, [A, B.toUpperCase()])).toEqual([
			`/dns4/new-a.example.com/tcp/443/tls/ws/p2p/${PEER_A}`,
			`/dns4/b.example.com/tcp/443/tls/ws/p2p/${PEER_B}`
		]);
	});

	it('ignores a stranger, however new, and anything unreadable', () => {
		expect(relaysFromPosts(payload, [STRANGER, 'nobody'])).toEqual([
			`/dns4/evil.example.com/tcp/443/tls/ws/p2p/${PEER_A}`
		]);
		expect(relaysFromPosts(payload, [])).toEqual([]);
		expect(relaysFromPosts({ posts: [{ sender: A, item_content: '{' }] }, [A])).toEqual([]);
		expect(relaysFromPosts(null, [A])).toEqual([]);
	});

	it('takes only what a browser on an https page can dial', () => {
		expect(browserDialable(`/dns4/a.example.com/tcp/443/tls/ws/p2p/${PEER_A}`)).toBe(true);
		expect(browserDialable(`/dns4/a.example.com/tcp/443/wss/p2p/${PEER_A}`)).toBe(true);
		expect(browserDialable(`/dns4/a.example.com/tcp/4002/ws/p2p/${PEER_A}`)).toBe(false);
		expect(browserDialable(`/ip4/1.2.3.4/tcp/443/tls/ws/p2p/${PEER_A}`)).toBe(false);
		expect(browserDialable('/dns4/a.example.com/tcp/443/tls/ws')).toBe(false);
	});
});

describe('relayAddrs', () => {
	it('uses the configured relays first, as the browser specs do', async () => {
		const configured = `/ip4/127.0.0.1/tcp/4492/ws/p2p/${PEER_A}, /ip4/127.0.0.1/tcp/4493/ws/p2p/${PEER_B}`;
		expect(await relayAddrs({ configured, fetch: () => Promise.reject(new Error('no')) })).toEqual([
			`/ip4/127.0.0.1/tcp/4492/ws/p2p/${PEER_A}`,
			`/ip4/127.0.0.1/tcp/4493/ws/p2p/${PEER_B}`
		]);
	});

	it('asks Aleph for the trusted wallets’ posts only', async () => {
		/** @type {URL | null} */
		let asked = null;
		const fetch = /** @type {any} */ (
			async (/** @type {URL} */ url) => {
				asked = url;
				return new Response(JSON.stringify({ posts: [] }));
			}
		);
		await relayAddrs({ configured: '', fetch });
		const url = /** @type {URL} */ (/** @type {unknown} */ (asked));
		expect(url.searchParams.get('channels')).toBe('simple-todo');
		expect(url.searchParams.get('refs')).toBe('simple-todo-bootstrap');
		expect(url.searchParams.get('types')).toBe('relay-bootstrap-v2');
		expect(url.searchParams.get('addresses')?.split(',')).toHaveLength(2);
	});

	it('falls back to the relays last known when Aleph cannot be asked or knows none', async () => {
		expect(
			await relayAddrs({ configured: '', fetch: () => Promise.reject(new Error('down')) })
		).toEqual([...FALLBACK_RELAYS]);
		const empty = /** @type {any} */ (async () => new Response(JSON.stringify({ posts: [] })));
		expect(await relayAddrs({ configured: '', fetch: empty })).toEqual([...FALLBACK_RELAYS]);
		const broken = /** @type {any} */ (async () => new Response('nope', { status: 503 }));
		expect(await relayAddrs({ configured: '', fetch: broken })).toEqual([...FALLBACK_RELAYS]);
	});
});
