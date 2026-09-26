/**
 * The Ethereum payment code: what `girocode.js` is for a SEPA transfer, for
 * Ether and for ERC-20 tokens on any EVM chain.
 *
 * The payload is an EIP-681 URI. Ether goes to the recipient directly:
 *
 *     ethereum:<recipient>@<chainId>?value=<wei>
 *
 * A token is a call of its contract's `transfer`:
 *
 *     ethereum:<token>@<chainId>/transfer?address=<recipient>&uint256=<units>
 *
 * The chain id is always written, also for mainnet (1): a wallet that guesses
 * the chain may pay on the wrong one, and a token sent on the wrong chain is
 * as good as lost. Amounts are integers in the smallest unit (wei, or the
 * token's own), kept as strings and written out in full, never in exponent
 * notation.
 *
 * Addresses are checked and printed with their EIP-55 checksum. An address in
 * mixed case must carry a correct checksum; all lower or all upper case has
 * none to check, which EIP-55 allows.
 *
 * There is no room for a reference: a transfer on chain carries none. The
 * invoice number stays on the invoice, and the payment is matched by address
 * and amount.
 */

import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** The largest uint256. */
const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * The address with its EIP-55 checksum, or null when it is not an address or
 * carries a wrong checksum.
 *
 * @param {string} address
 * @returns {string | null}
 */
export function checksumAddress(address) {
	const text = String(address ?? '').trim();
	if (!/^0x[0-9a-fA-F]{40}$/.test(text)) return null;
	const hex = text.slice(2);
	const lower = hex.toLowerCase();
	const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
	const checksummed = [...lower]
		.map((char, i) => (parseInt(hash[i], 16) >= 8 ? char.toUpperCase() : char))
		.join('');
	const mixed = hex !== lower && hex !== hex.toUpperCase();
	if (mixed && hex !== checksummed) return null;
	return `0x${checksummed}`;
}

/**
 * @param {unknown} value
 * @returns {bigint | null} a positive integer that fits a uint256
 */
function positiveAmount(value) {
	if (!/^\d+$/.test(String(value ?? ''))) return null;
	const amount = BigInt(/** @type {string} */ (value));
	return amount >= 1n && amount <= MAX_UINT256 ? amount : null;
}

/** @param {unknown} chainId */
function validChainId(chainId) {
	return Number.isSafeInteger(chainId) && /** @type {number} */ (chainId) > 0;
}

/**
 * The payload for Ether (or a chain's native coin), or null when the invoice
 * cannot carry one: no valid address, no chain, or an amount that is not a
 * positive whole number of wei — a Storno is negative.
 *
 * @param {{ address: string, chainId: number, amountWei: string }} payment
 * @returns {string | null}
 */
export function ethereumUri({ address, chainId, amountWei }) {
	const target = checksumAddress(address);
	const amount = positiveAmount(amountWei);
	if (target === null || amount === null || !validChainId(chainId)) return null;
	return `ethereum:${target}@${chainId}?value=${amount}`;
}

/**
 * The payload for an ERC-20 token, or null when the invoice cannot carry one.
 *
 * @param {{ token: string, chainId: number, address: string, amount: string }} payment
 *   `token` the contract, `address` the recipient, `amount` in the token's smallest unit
 * @returns {string | null}
 */
export function erc20Uri({ token, chainId, address, amount }) {
	const contract = checksumAddress(token);
	const recipient = checksumAddress(address);
	const units = positiveAmount(amount);
	if (contract === null || recipient === null || units === null || !validChainId(chainId))
		return null;
	return `ethereum:${contract}@${chainId}/transfer?address=${recipient}&uint256=${units}`;
}
