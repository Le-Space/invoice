/**
 * The payment code of an invoice in a crypto currency: what the GiroCode is
 * for an invoice in euros.
 *
 * Which code a currency gets, and which of the issuer's addresses it pays to:
 *
 * | Currency | Code                              | Address   |
 * |----------|-----------------------------------|-----------|
 * | BTC      | BIP-21, with the amount           | `btc`     |
 * | ETH      | EIP-681 on Ethereum (1)           | `eth`     |
 * | POL      | EIP-681 on Polygon (137)          | `eth`     |
 * | USDC     | EIP-681 `transfer` on Ethereum    | `eth`     |
 * | NYM      | the address alone                 | `nym`     |
 * | AKT      | the address alone                 | `akt`     |
 *
 * Cosmos chains have no payment URI that wallets agree on, so a NYM or AKT
 * invoice carries a code of the address, and the amount is typed in by hand —
 * the payment sentence names it. USDC is taken to be the one on Ethereum
 * mainnet; an invoice for USDC on another chain needs a template for it.
 *
 * The amount is the invoice's due amount, scaled from the invoice's decimals
 * to the chain's (`toChainUnits`), so a code for 0,0015 ETH asks for exactly
 * 1500000000000000 wei.
 */

import { bech32 } from '@scure/base';
import { bitcoinAddress, bitcoinUri } from './bip21.js';
import { toChainUnits } from './currency.js';
import { checksumAddress, erc20Uri, ethereumUri } from './eip681.js';

/** USDC on Ethereum mainnet (Circle's contract). */
const USDC_ETHEREUM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

/**
 * @typedef {{ scheme: 'bip21' } | { scheme: 'eip681', chainId: number } | { scheme: 'erc20', chainId: number, token: string } | { scheme: 'address', prefix: string }} Scheme
 */

/** @type {Readonly<Record<string, { address: 'btc' | 'eth' | 'nym' | 'akt', scheme: Scheme }>>} */
export const PAYMENT_SCHEMES = Object.freeze({
	BTC: { address: 'btc', scheme: { scheme: 'bip21' } },
	ETH: { address: 'eth', scheme: { scheme: 'eip681', chainId: 1 } },
	POL: { address: 'eth', scheme: { scheme: 'eip681', chainId: 137 } },
	USDC: { address: 'eth', scheme: { scheme: 'erc20', chainId: 1, token: USDC_ETHEREUM } },
	NYM: { address: 'nym', scheme: { scheme: 'address', prefix: 'n' } },
	AKT: { address: 'akt', scheme: { scheme: 'address', prefix: 'akash' } }
});

/**
 * A Cosmos address with the chain's prefix and a valid bech32 checksum, in
 * lower case; null otherwise.
 *
 * @param {unknown} address
 * @param {string} prefix
 */
export function cosmosAddress(address, prefix) {
	const text = String(address ?? '')
		.trim()
		.toLowerCase();
	try {
		const decoded = bech32.decode(/** @type {`${string}1${string}`} */ (text));
		const bytes = bech32.fromWords(decoded.words);
		return decoded.prefix === prefix && (bytes.length === 20 || bytes.length === 32) ? text : null;
	} catch {
		return null;
	}
}

/**
 * The issuer's address for an invoice in `currency`, checked for that chain,
 * or null when there is none or it is not an address there.
 *
 * @param {string} currency
 * @param {{ btc?: string, eth?: string, nym?: string, akt?: string } | undefined} crypto
 */
export function payToAddress(currency, crypto) {
	const entry = PAYMENT_SCHEMES[currency];
	if (!entry) return null;
	const raw = crypto?.[entry.address];
	const { scheme } = entry;
	if (scheme.scheme === 'bip21') return bitcoinAddress(String(raw ?? ''));
	if (scheme.scheme === 'address') return cosmosAddress(raw, scheme.prefix);
	return checksumAddress(String(raw ?? ''));
}

/**
 * The code an invoice in a crypto currency carries, or null: for a currency
 * without a scheme, an issuer without an address for it, or nothing to pay (a
 * Storno owes money the other way).
 *
 * @param {{
 *   currency: string,
 *   unit: { code: string, decimals: number },
 *   due: string,
 *   crypto: { btc?: string, eth?: string, nym?: string, akt?: string } | undefined,
 *   label?: string,
 *   message?: string
 * }} params
 * @returns {{ payload: string, address: string, withAmount: boolean } | null}
 */
export function cryptoPaymentCode({ currency, unit, due, crypto, label = '', message = '' }) {
	const entry = PAYMENT_SCHEMES[currency];
	const address = payToAddress(currency, crypto);
	const amount = toChainUnits(due, unit);
	if (!entry || !address || amount === null || BigInt(amount) <= 0n) return null;

	const { scheme } = entry;
	/** @type {string | null} */
	let payload = null;
	if (scheme.scheme === 'bip21') {
		payload = bitcoinUri({ address, amountSats: amount, label, message });
	} else if (scheme.scheme === 'eip681') {
		payload = ethereumUri({ address, chainId: scheme.chainId, amountWei: amount });
	} else if (scheme.scheme === 'erc20') {
		payload = erc20Uri({ token: scheme.token, chainId: scheme.chainId, address, amount });
	} else {
		payload = address;
	}
	return payload ? { payload, address, withAmount: scheme.scheme !== 'address' } : null;
}
