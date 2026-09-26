/**
 * The Bitcoin payment code: what `girocode.js` is for a SEPA transfer.
 *
 * A wallet that scans it fills in address, amount and a note, so nobody copies
 * an address by hand. The payload is a BIP-21 URI:
 *
 *     bitcoin:<address>?amount=<BTC>&label=<recipient>&message=<reference>
 *
 * The amount is given here in satoshi, as an integer in a string — the way
 * every crypto quantity is kept — and written out in BTC with at most eight
 * decimals, never in exponent notation, which BIP-21 does not allow.
 *
 * An address is checked before it is printed: its checksum (Base58Check for
 * legacy and P2SH, bech32 or bech32m for SegWit), and that it is a mainnet
 * address. A mistyped address on an invoice sends the money nowhere, and no
 * one can send it back.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bech32, bech32m, createBase58check } from '@scure/base';

const base58check = createBase58check(sha256);

/** Mainnet version bytes: P2PKH and P2SH. */
const BASE58_VERSIONS = new Set([0x00, 0x05]);

/** The largest amount there can ever be: 21 million BTC in satoshi. */
const MAX_SATS = 2_100_000_000_000_000n;

/**
 * The address in the form a wallet expects, or null when it is not a valid
 * mainnet Bitcoin address.
 *
 * @param {string} address
 * @returns {string | null}
 */
export function bitcoinAddress(address) {
	const text = String(address ?? '').trim();
	if (/^bc1/i.test(text)) return segwitAddress(text);
	try {
		const bytes = base58check.decode(text);
		return bytes.length === 21 && BASE58_VERSIONS.has(bytes[0]) ? text : null;
	} catch {
		return null;
	}
}

/** @param {string} text */
function segwitAddress(text) {
	// bech32 is case-insensitive but must not mix cases.
	if (text !== text.toLowerCase() && text !== text.toUpperCase()) return null;
	const address = text.toLowerCase();
	for (const codec of [bech32, bech32m]) {
		let decoded;
		try {
			decoded = codec.decode(/** @type {`${string}1${string}`} */ (address));
		} catch {
			continue;
		}
		const [version, ...words] = decoded.words;
		if (decoded.prefix !== 'bc' || version === undefined || version > 16) return null;
		// Version 0 is bech32, every later one bech32m (BIP-350).
		if ((version === 0) !== (codec === bech32)) return null;
		let program;
		try {
			program = codec.fromWords(words);
		} catch {
			return null;
		}
		if (program.length < 2 || program.length > 40) return null;
		if (version === 0 && program.length !== 20 && program.length !== 32) return null;
		return address;
	}
	return null;
}

/**
 * Satoshi in BTC, as BIP-21 writes it: no exponent, no trailing zeros.
 *
 * @param {bigint} sats
 */
function btcAmount(sats) {
	const whole = sats / 100_000_000n;
	const fraction = (sats % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
	return fraction === '' ? whole.toString() : `${whole}.${fraction}`;
}

/** RFC 3986: a space is %20, never "+". */
const encode = (/** @type {string} */ text) => encodeURIComponent(text);

/**
 * The payload of the code, or null when the invoice cannot carry one.
 *
 * Reasons it cannot: the address is not a valid mainnet address, or the amount
 * is not a positive whole number of satoshi — a Storno is negative, and no
 * payment can carry that.
 *
 * @param {{ address: string, amountSats: string, label?: string, message?: string }} payment
 * @returns {string | null}
 */
export function bitcoinUri({ address, amountSats, label = '', message = '' }) {
	const target = bitcoinAddress(address);
	if (target === null) return null;
	if (!/^\d+$/.test(String(amountSats ?? ''))) return null;
	const sats = BigInt(amountSats);
	if (sats < 1n || sats > MAX_SATS) return null;

	const params = [`amount=${btcAmount(sats)}`];
	const name = String(label ?? '').trim();
	if (name !== '') params.push(`label=${encode(name)}`);
	const note = String(message ?? '').trim();
	if (note !== '') params.push(`message=${encode(note)}`);
	return `bitcoin:${target}?${params.join('&')}`;
}
