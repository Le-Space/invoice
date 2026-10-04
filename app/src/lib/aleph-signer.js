// The books' Aleph key at work: its address, and the signature a backup's
// STORE message carries (Le-Space/invoice#28). The key itself is made and
// checked in aleph-key.js, without this module's curve code, which only the
// page that makes a backup loads.
//
// Aleph keeps a backup for as long as a STORE message names it and an account
// pays for it. The paying account is belege's bridge account; it lets this key
// send STORE messages on the channel INVOICE-BACKUP, once
// (`pnpm setup:aleph -- --authorize <address> --channel INVOICE-BACKUP`), and
// from then on the browser signs alone, without the bridge running. Aleph
// charges the account, never this key (measured 2026-10-03,
// NiKrause/orbitdb-storage-bridge#147).
//
// The key is a secp256k1 secret in the books' vault (books-vault.js), so every
// registered passkey has it, and one grant serves all of them. Its address is
// public: it is what the grant names. The signature is `personal_sign`
// (EIP-191), as a browser wallet makes it and as Aleph checks it.

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

/** @param {Uint8Array} bytes */
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * An address in EIP-55 form, as Aleph keys its accounts (a lower-case one
 * finds nothing there).
 *
 * @param {string} address 0x and 40 hex digits
 */
export function toChecksumAddress(address) {
	const lower = address.toLowerCase().replace(/^0x/, '');
	const hash = hex(keccak_256(new TextEncoder().encode(lower)));
	return `0x${[...lower].map((c, i) => (parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c)).join('')}`;
}

/**
 * The key's address: the last 20 bytes of the Keccak-256 hash of its public key.
 *
 * @param {Uint8Array} key
 */
export function alephAddressOf(key) {
	const publicKey = secp256k1.getPublicKey(key, false).slice(1);
	return toChecksumAddress(`0x${hex(keccak_256(publicKey).slice(-20))}`);
}

/**
 * `personal_sign`: the message prefixed as EIP-191 says, hashed with
 * Keccak-256, signed, and written r ‖ s ‖ v with v = 27 + the recovery bit.
 *
 * @param {Uint8Array} key
 * @param {string} message
 * @returns {string} 0x and 130 hex digits
 */
export function alephSign(key, message) {
	const body = new TextEncoder().encode(message);
	const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`);
	const digest = keccak_256(new Uint8Array([...prefix, ...body]));
	// `recovered` puts the recovery bit first; Ethereum wants it last, plus 27.
	const signature = secp256k1.sign(digest, key, { prehash: false, format: 'recovered' });
	return `0x${hex(signature.slice(1))}${(27 + signature[0]).toString(16)}`;
}
