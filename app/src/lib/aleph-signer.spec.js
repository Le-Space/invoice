import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { isAlephKey, newAlephKey } from './aleph-key.js';
import { alephAddressOf, alephSign, toChecksumAddress } from './aleph-signer.js';

/** @param {string} hex */
const bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

describe('the books’ Aleph key', () => {
	it('has the address and the personal_sign an Ethereum wallet has', () => {
		// The example from the web3.js documentation (eth.accounts.sign): a public test key.
		const key = bytes('4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318');
		expect(alephAddressOf(key)).toBe('0x2c7536E3605D9C16a7a3D7b1898e529396a65c23');
		expect(alephSign(key, 'Some data')).toBe(
			'0xb91467e570a6466aa9e9876cbcd013baba02900b8979d43fe208a4a4f339f5fd6007e74cd82e037b800186422fc2da167c747ef045e5d18a5f5d4300f8e1a0291c'
		);
	});

	it('writes addresses as EIP-55 says, the form Aleph keys accounts by', () => {
		// The example from EIP-55 itself.
		expect(toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(
			'0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
		);
	});

	it('signs what Aleph checks: the signer is recovered from the signature', () => {
		const key = newAlephKey();
		const message = ['ETH', alephAddressOf(key), 'STORE', 'a'.repeat(64)].join('\n');
		const signature = bytes(alephSign(key, message).slice(2));
		const body = new TextEncoder().encode(message);
		const digest = keccak_256(
			new Uint8Array([
				...new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`),
				...body
			])
		);
		const recovered = secp256k1.recoverPublicKey(
			new Uint8Array([signature[64] - 27, ...signature.subarray(0, 64)]),
			digest,
			{ prehash: false }
		);
		const point = secp256k1.Point.fromBytes(recovered).toBytes(false).slice(1);
		const address = `0x${Array.from(keccak_256(point).slice(-20), (b) => b.toString(16).padStart(2, '0')).join('')}`;
		expect(toChecksumAddress(address)).toBe(alephAddressOf(key));
	});

	it('makes only valid keys, and knows one as the curve library does', () => {
		const key = newAlephKey();
		expect(key).toHaveLength(32);
		expect(isAlephKey(key)).toBe(true);
		expect(newAlephKey()).not.toEqual(key);
		/** @param {string} h */
		const k = (h) => bytes(h.padStart(64, '0'));
		const order = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141';
		// The edges, against @noble/curves' own judgement.
		for (const [candidate, valid] of /** @type {[Uint8Array, boolean][]} */ ([
			[new Uint8Array(32), false], // zero
			[k('1'), true],
			[k(order), false], // the order itself
			[k('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140'), true], // one below
			[k('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364142'), false], // one above
			[new Uint8Array(32).fill(0xff), false],
			[key, true]
		])) {
			expect(isAlephKey(candidate)).toBe(valid);
			expect(secp256k1.utils.isValidSecretKey(candidate)).toBe(valid);
		}
		expect(isAlephKey(new Uint8Array(31).fill(1))).toBe(false);
		expect(isAlephKey('4c08')).toBe(false);
	});
});
