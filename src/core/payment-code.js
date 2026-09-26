/**
 * The payment code of an invoice in a crypto currency: what the GiroCode is
 * for an invoice in euros.
 *
 * Which code an invoice gets depends on its currency and the network it is
 * paid on (`networks.js`), and which of the issuer's addresses it pays to on
 * its currency:
 *
 * | Currency | Network                        | Code                           | Address |
 * |----------|--------------------------------|--------------------------------|---------|
 * | BTC      | bitcoin                        | BIP-21, with the amount        | `btc`   |
 * | ETH      | ethereum, base, arbitrum, optimism | EIP-681 on that chain id   | `eth`   |
 * | POL      | polygon                        | EIP-681 on 137                 | `eth`   |
 * | USDC     | ethereum, base, arbitrum, optimism, polygon | EIP-681 `transfer` on that chain's USDC contract | `eth` |
 * | NYM      | nyx                            | the address alone              | `nym`   |
 * | AKT      | akash                          | the address alone              | `akt`   |
 *
 * Cosmos chains have no payment URI that wallets agree on, so a NYM or AKT
 * invoice carries a code of the address, and the amount is typed in by hand —
 * the payment sentence names it.
 *
 * The amount is the invoice's due amount, scaled from the invoice's decimals
 * to the chain's (`toChainUnits`), so a code for 0,0015 ETH asks for exactly
 * 1500000000000000 wei.
 */

import { bech32 } from '@scure/base';
import { bitcoinAddress, bitcoinUri } from './bip21.js';
import { toChainUnits } from './currency.js';
import { checksumAddress, erc20Uri, ethereumUri } from './eip681.js';
import { defaultNetwork, networkOf, paysOn } from './networks.js';

/**
 * Which of the issuer's addresses a currency is paid to, and how it is
 * checked: an EVM address is the same on every EVM chain.
 *
 * @type {Readonly<Record<string, { key: 'btc' | 'eth' | 'nym' | 'akt', kind: 'bitcoin' | 'evm' | 'cosmos', prefix?: string }>>}
 */
export const PAY_TO = Object.freeze({
	BTC: { key: 'btc', kind: 'bitcoin' },
	ETH: { key: 'eth', kind: 'evm' },
	POL: { key: 'eth', kind: 'evm' },
	USDC: { key: 'eth', kind: 'evm' },
	NYM: { key: 'nym', kind: 'cosmos', prefix: 'n' },
	AKT: { key: 'akt', kind: 'cosmos', prefix: 'akash' }
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
	if (!Object.hasOwn(PAY_TO, currency)) return null;
	const entry = PAY_TO[currency];
	const raw = crypto?.[entry.key];
	if (entry.kind === 'bitcoin') return bitcoinAddress(String(raw ?? ''));
	if (entry.kind === 'cosmos') return cosmosAddress(raw, /** @type {string} */ (entry.prefix));
	return checksumAddress(String(raw ?? ''));
}

/**
 * The code an invoice in a crypto currency carries, or null: for a currency
 * without a scheme, an issuer without an address for it, or nothing to pay (a
 * Storno owes money the other way).
 *
 * @param {{
 *   currency: string,
 *   network?: string | null,
 *   unit: { code: string, decimals: number },
 *   due: string,
 *   crypto: { btc?: string, eth?: string, nym?: string, akt?: string } | undefined,
 *   label?: string,
 *   message?: string
 * }} params
 * @returns {{ payload: string, address: string, withAmount: boolean } | null}
 */
export function cryptoPaymentCode({
	currency,
	network = defaultNetwork(currency),
	unit,
	due,
	crypto,
	label = '',
	message = ''
}) {
	const net = networkOf(network);
	const address = payToAddress(currency, crypto);
	const amount = toChainUnits(due, unit);
	if (!net || !paysOn(currency, net.id) || !address || amount === null || BigInt(amount) <= 0n) {
		return null;
	}

	const kind = PAY_TO[currency].kind;
	/** @type {string | null} */
	let payload = null;
	if (kind === 'bitcoin') {
		payload = bitcoinUri({ address, amountSats: amount, label, message });
	} else if (kind === 'cosmos') {
		payload = address;
	} else if (currency === 'USDC') {
		payload = erc20Uri({
			token: /** @type {string} */ (net.usdc),
			chainId: /** @type {number} */ (net.chainId),
			address,
			amount
		});
	} else {
		payload = ethereumUri({
			address,
			chainId: /** @type {number} */ (net.chainId),
			amountWei: amount
		});
	}
	return payload ? { payload, address, withAmount: kind !== 'cosmos', network: net.name } : null;
}
