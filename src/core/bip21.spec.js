import { describe, expect, it } from 'vitest';
import { bitcoinAddress, bitcoinUri } from './bip21.js';

// Test vectors of BIP-173 and BIP-350, and addresses made of zero bytes.
const P2WPKH = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const P2TR = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';
const P2PKH = '1111111111111111111114oLvT2';
const P2SH = '31h1vYVSYuKP6AhS86fbRdMw9XHieotbST';

describe('bitcoinAddress', () => {
	it('takes every mainnet kind', () => {
		for (const address of [P2WPKH, P2TR, P2PKH, P2SH]) {
			expect(bitcoinAddress(address)).toBe(address);
		}
	});

	it('writes bech32 in lower case, as wallets expect', () => {
		expect(bitcoinAddress(P2WPKH.toUpperCase())).toBe(P2WPKH);
		expect(bitcoinAddress(`  ${P2WPKH} `)).toBe(P2WPKH);
	});

	it('refuses a typo, which is what the checksum is for', () => {
		expect(bitcoinAddress(P2WPKH.replace('w508', 'w509'))).toBeNull();
		expect(bitcoinAddress(P2PKH.replace('oLvT2', 'oLvT3'))).toBeNull();
	});

	it('refuses mixed case, a testnet address and the wrong bech32 variant', () => {
		expect(bitcoinAddress('bc1qW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBeNull();
		expect(bitcoinAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBeNull();
		// BIP-350: a version 1 program in bech32 instead of bech32m.
		expect(
			bitcoinAddress('bc1pqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs3wf0qm')
		).toBeNull();
		expect(bitcoinAddress('')).toBeNull();
		expect(bitcoinAddress('not an address')).toBeNull();
	});
});

describe('bitcoinUri', () => {
	const payment = {
		address: P2WPKH,
		amountSats: '150000',
		label: 'Wolkenfabrik Hosting UG',
		message: 'Rechnung 2026-00000-001'
	};

	it('is a BIP-21 URI with the amount in BTC', () => {
		expect(bitcoinUri(payment)).toBe(
			`bitcoin:${P2WPKH}?amount=0.0015&label=Wolkenfabrik%20Hosting%20UG&message=Rechnung%202026-00000-001`
		);
	});

	it('writes the amount without an exponent and without trailing zeros', () => {
		const amount = (/** @type {string} */ sats) =>
			new URL(bitcoinUri({ address: P2WPKH, amountSats: sats }) ?? '').searchParams.get('amount');
		expect(amount('1')).toBe('0.00000001');
		expect(amount('100000000')).toBe('1');
		expect(amount('2100000000000000')).toBe('21000000');
		expect(amount('123456789')).toBe('1.23456789');
	});

	it('leaves out an empty label and message', () => {
		expect(bitcoinUri({ address: P2WPKH, amountSats: '1', label: ' ', message: '' })).toBe(
			`bitcoin:${P2WPKH}?amount=0.00000001`
		);
	});

	it('encodes what a URI cannot carry as it is', () => {
		const uri = bitcoinUri({ ...payment, label: 'Müller & Söhne', message: 'a=b?c' }) ?? '';
		const params = new URL(uri).searchParams;
		expect(params.get('label')).toBe('Müller & Söhne');
		expect(params.get('message')).toBe('a=b?c');
		expect(uri).not.toContain('+');
	});

	it('refuses what no payment could carry', () => {
		expect(bitcoinUri({ ...payment, address: 'not an address' })).toBeNull();
		// A Storno is a negative amount; a payment has no such thing.
		expect(bitcoinUri({ ...payment, amountSats: '-150000' })).toBeNull();
		expect(bitcoinUri({ ...payment, amountSats: '0' })).toBeNull();
		expect(bitcoinUri({ ...payment, amountSats: '0.5' })).toBeNull();
		expect(bitcoinUri({ ...payment, amountSats: '2100000000000001' })).toBeNull();
	});
});
