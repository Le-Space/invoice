import { describe, expect, it } from 'vitest';
import { checksumAddress, erc20Uri, ethereumUri } from './eip681.js';

// Test vectors of EIP-55, and the USDC contract on Ethereum mainnet.
const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const OTHER = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

describe('checksumAddress', () => {
	it('gives the EIP-55 form', () => {
		for (const address of [ADDRESS, OTHER, USDC]) {
			expect(checksumAddress(address.toLowerCase())).toBe(address);
			expect(checksumAddress(`0x${address.slice(2).toUpperCase()}`)).toBe(address);
			expect(checksumAddress(address)).toBe(address);
		}
	});

	it('refuses a mixed-case address with a wrong checksum, which is a typo', () => {
		expect(checksumAddress(ADDRESS.replace('aAeb', 'AAeb'))).toBeNull();
	});

	it('refuses what is not an address', () => {
		expect(checksumAddress('')).toBeNull();
		expect(checksumAddress('0x1234')).toBeNull();
		expect(checksumAddress(ADDRESS.slice(2))).toBeNull();
		expect(checksumAddress(`${ADDRESS}00`)).toBeNull();
	});
});

describe('ethereumUri', () => {
	it('pays Ether with the chain and the amount in wei', () => {
		expect(
			ethereumUri({ address: ADDRESS.toLowerCase(), chainId: 1, amountWei: '1500000000000000' })
		).toBe(`ethereum:${ADDRESS}@1?value=1500000000000000`);
	});

	it('names any EVM chain', () => {
		expect(ethereumUri({ address: ADDRESS, chainId: 8453, amountWei: '1' })).toBe(
			`ethereum:${ADDRESS}@8453?value=1`
		);
	});

	it('refuses what no payment could carry', () => {
		const payment = { address: ADDRESS, chainId: 1, amountWei: '1' };
		expect(ethereumUri({ ...payment, address: 'not an address' })).toBeNull();
		expect(ethereumUri({ ...payment, amountWei: '-1' })).toBeNull();
		expect(ethereumUri({ ...payment, amountWei: '0' })).toBeNull();
		expect(ethereumUri({ ...payment, amountWei: '1e18' })).toBeNull();
		expect(ethereumUri({ ...payment, amountWei: (1n << 256n).toString() })).toBeNull();
		expect(ethereumUri({ ...payment, chainId: 0 })).toBeNull();
		expect(ethereumUri({ ...payment, chainId: 1.5 })).toBeNull();
	});
});

describe('erc20Uri', () => {
	it('calls the token’s transfer, with recipient and amount in the token’s unit', () => {
		expect(
			erc20Uri({ token: USDC.toLowerCase(), chainId: 1, address: ADDRESS, amount: '119000000' })
		).toBe(`ethereum:${USDC}@1/transfer?address=${ADDRESS}&uint256=119000000`);
	});

	it('refuses a wrong contract or recipient, and an amount no transfer carries', () => {
		const payment = { token: USDC, chainId: 1, address: ADDRESS, amount: '1' };
		expect(erc20Uri({ ...payment, token: '0x1234' })).toBeNull();
		expect(erc20Uri({ ...payment, address: OTHER.replace('fB69', 'FB69') })).toBeNull();
		expect(erc20Uri({ ...payment, amount: '0' })).toBeNull();
		expect(erc20Uri({ ...payment, chainId: -1 })).toBeNull();
	});
});
