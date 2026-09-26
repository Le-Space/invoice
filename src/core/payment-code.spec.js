import { describe, expect, it } from 'vitest';
import { cosmosAddress, cryptoPaymentCode, payToAddress } from './payment-code.js';

// Test vectors of BIP-173 and EIP-55, and Cosmos addresses made of zero bytes.
const BTC = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const ETH = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const NYM = 'n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp8hacc';
const AKT = 'akash1qyqszqgpqyqszqgpqyqszqgpqyqszqgplgve5x';
const crypto = { btc: BTC, eth: ETH.toLowerCase(), nym: NYM, akt: AKT };

const code = (/** @type {string} */ currency, /** @type {number} */ decimals, due = '150000') =>
	cryptoPaymentCode({
		currency,
		unit: { code: currency, decimals },
		due,
		crypto,
		label: 'Wolkenfabrik UG',
		message: 'Rechnung 2026-00000-001'
	});

describe('cryptoPaymentCode', () => {
	it('asks for bitcoin with BIP-21, amount and reference included', () => {
		expect(code('BTC', 8)).toEqual({
			payload: `bitcoin:${BTC}?amount=0.0015&label=Wolkenfabrik%20UG&message=Rechnung%202026-00000-001`,
			address: BTC,
			withAmount: true,
			network: 'Bitcoin'
		});
	});

	it('asks for Ether in wei, scaled from the invoice’s decimals', () => {
		// 0.0015 ETH invoiced in 10⁻⁸
		expect(code('ETH', 8)?.payload).toBe(`ethereum:${ETH}@1?value=1500000000000000`);
		// An invoice written with 18 decimals is read in 18.
		expect(code('ETH', 18, '1500000000000000')?.payload).toBe(
			`ethereum:${ETH}@1?value=1500000000000000`
		);
	});

	it('asks for POL on Polygon, and for USDC through the token contract on Ethereum', () => {
		expect(code('POL', 8)?.payload).toBe(`ethereum:${ETH}@137?value=1500000000000000`);
		expect(code('USDC', 6, '119000000')?.payload).toBe(
			`ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48@1/transfer?address=${ETH}&uint256=119000000`
		);
	});

	it('gives the address alone for NYM and AKT, where wallets agree on no URI', () => {
		expect(code('NYM', 6)).toEqual({
			payload: NYM,
			address: NYM,
			withAmount: false,
			network: 'Nyx'
		});
		expect(code('AKT', 6)?.payload).toBe(AKT);
	});

	it('gives none for a Storno, a fiat currency, or an issuer without an address', () => {
		expect(code('BTC', 8, '-150000')).toBeNull();
		expect(code('BTC', 8, '0')).toBeNull();
		expect(code('EUR', 2)).toBeNull();
		expect(
			cryptoPaymentCode({
				currency: 'NYM',
				unit: { code: 'NYM', decimals: 6 },
				due: '1',
				crypto: {}
			})
		).toBeNull();
	});
});

describe('the network a code is for', () => {
	const on = (/** @type {string} */ currency, /** @type {string} */ network, due = '119000000') =>
		cryptoPaymentCode({
			currency,
			network,
			unit: { code: currency, decimals: currency === 'USDC' ? 6 : 8 },
			due,
			crypto
		});

	it('asks for USDC through the contract of the chain it is paid on', () => {
		expect(on('USDC', 'base')?.payload).toBe(
			`ethereum:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913@8453/transfer?address=${ETH}&uint256=119000000`
		);
		expect(on('USDC', 'polygon')?.payload).toMatch(
			/^ethereum:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359@137\//
		);
		expect(on('USDC', 'arbitrum')?.payload).toMatch(/@42161\//);
		expect(on('USDC', 'optimism')?.payload).toMatch(/@10\//);
	});

	it('asks for Ether on the chain it is paid on', () => {
		expect(on('ETH', 'base', '150000')?.payload).toBe(
			`ethereum:${ETH}@8453?value=1500000000000000`
		);
		expect(on('ETH', 'arbitrum', '150000')?.network).toBe('Arbitrum');
	});

	it('gives none for a network the currency is not on', () => {
		expect(on('ETH', 'polygon')).toBeNull();
		expect(on('NYM', 'base')).toBeNull();
		expect(on('USDC', 'nowhere')).toBeNull();
	});
});

describe('payToAddress', () => {
	it('checks the address for the chain it is for', () => {
		expect(payToAddress('ETH', crypto)).toBe(ETH);
		expect(payToAddress('NYM', { nym: AKT })).toBeNull();
		expect(payToAddress('AKT', { akt: NYM })).toBeNull();
		expect(payToAddress('BTC', { btc: 'bc1qexample' })).toBeNull();
		expect(payToAddress('ETH', { eth: ETH.replace('aAeb', 'AAeb') })).toBeNull();
		expect(payToAddress('USD', crypto)).toBeNull();
	});
});

describe('cosmosAddress', () => {
	it('takes the prefix and the checksum, and writes it in lower case', () => {
		expect(cosmosAddress(NYM.toUpperCase(), 'n')).toBe(NYM);
		expect(cosmosAddress(NYM.replace('p8hacc', 'p8hacd'), 'n')).toBeNull();
		expect(cosmosAddress('', 'n')).toBeNull();
	});
});
