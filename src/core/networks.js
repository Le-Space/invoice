/**
 * The networks an invoice in a crypto currency can be paid on.
 *
 * A currency is not enough to pay: USDC and Ether live on several chains, and
 * a payment sent on the wrong one is as good as lost. So an invoice in one of
 * them names its network, and the payment code, the address line and the
 * template say it.
 *
 * The ids, chain ids and USDC contracts are those of Belege's chain registry
 * (Le-Space/belege, bridge/src/chains/registry.js), so a network named on an
 * invoice is the one Belege reads the payment from.
 */

/**
 * @typedef {object} Network
 * @property {string} id
 * @property {string} name how the invoice names it
 * @property {number} [chainId] EVM chains
 * @property {string} [usdc] the USDC contract (Circle's), EVM chains
 */

/** @type {Readonly<Record<string, Network>>} */
export const NETWORKS = Object.freeze({
	bitcoin: { id: 'bitcoin', name: 'Bitcoin' },
	ethereum: {
		id: 'ethereum',
		name: 'Ethereum',
		chainId: 1,
		usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
	},
	base: {
		id: 'base',
		name: 'Base',
		chainId: 8453,
		usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
	},
	arbitrum: {
		id: 'arbitrum',
		name: 'Arbitrum',
		chainId: 42161,
		usdc: '0xaf88d065e77c8cc2239327c5edb3a432268e5831'
	},
	optimism: {
		id: 'optimism',
		name: 'Optimism',
		chainId: 10,
		usdc: '0x0b2c639c533813f4aa9d7837caf62653d097ff85'
	},
	polygon: {
		id: 'polygon',
		name: 'Polygon',
		chainId: 137,
		usdc: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'
	},
	nyx: { id: 'nyx', name: 'Nyx' },
	akash: { id: 'akash', name: 'Akash' }
});

/**
 * Where each crypto currency can be paid, the first being what an invoice
 * without a network meant before invoices had one.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const CURRENCY_NETWORKS = Object.freeze({
	BTC: ['bitcoin'],
	ETH: ['ethereum', 'base', 'arbitrum', 'optimism'],
	POL: ['polygon'],
	USDC: ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon'],
	NYM: ['nyx'],
	AKT: ['akash']
});

/**
 * @param {string | null | undefined} id
 * @returns {Network | null}
 */
export function networkOf(id) {
	const key = String(id ?? '');
	return Object.hasOwn(NETWORKS, key) ? NETWORKS[key] : null;
}

/**
 * The network a currency is paid on by default, or null for one that is not
 * paid on a chain (euros, dollars).
 *
 * @param {string | null | undefined} currency
 */
export function defaultNetwork(currency) {
	const key = String(currency ?? '');
	return Object.hasOwn(CURRENCY_NETWORKS, key) ? CURRENCY_NETWORKS[key][0] : null;
}

/**
 * Whether `currency` can be paid on `network`.
 *
 * @param {string} currency
 * @param {string | null | undefined} network
 */
export function paysOn(currency, network) {
	return Object.hasOwn(CURRENCY_NETWORKS, currency)
		? CURRENCY_NETWORKS[currency].includes(String(network ?? ''))
		: network == null;
}
