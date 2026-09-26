// Ported from Le-Space/belege (app/src/lib/database-keys.spec.js) at 9a40d22 and published here
// under the MIT license by its author. Changed: Belege's names (storage paths,
// key info strings, database names) are the invoice app's.
// Replaces Le-Space/simple-todo apps/invoice01 (src/lib/database-keys.spec.js) at 56647d5,
// whose subject (a random key in local storage) belege does not have.
import { describe, expect, it } from 'vitest';

import { newKey, sealer } from './db-encryption.js';
import { DB_KEY_INFO, deriveDatabaseKey, deriveDatabaseName } from './database-keys.js';

const prf = () => crypto.getRandomValues(new Uint8Array(32));
const hex = (/** @type {Uint8Array} */ b) => Buffer.from(b).toString('hex');

describe('database-keys', () => {
	it('derives the same key from the same PRF output, which is what survives a reload', async () => {
		const output = prf();

		const first = await deriveDatabaseKey(output);
		const second = await deriveDatabaseKey(Uint8Array.from(output));

		expect(first).toHaveLength(32);
		expect(hex(second)).toBe(hex(first));
	});

	it('matches a fixed vector, so a refactor cannot rotate every key unnoticed', async () => {
		// A changed derivation locks every user out of their books. This value was
		// computed independently with Node's crypto.hkdfSync(sha256, 32 × 0x07, empty salt, "invoice/db-key/v1").
		const output = new Uint8Array(32).fill(7);

		expect(hex(await deriveDatabaseKey(output))).toBe(
			'53839e87f7cfba4c8d1b11c3022d23be8e53b9143aa2e0d34ec93b7943ef8483'
		);
	});

	it('derives a different key under a different info string', async () => {
		const output = prf();

		const current = await deriveDatabaseKey(output, DB_KEY_INFO);
		const other = await deriveDatabaseKey(output, 'invoice/db-key/v2');

		expect(hex(other)).not.toBe(hex(current));
	});

	it('derives a different key from a different passkey', async () => {
		expect(hex(await deriveDatabaseKey(prf()))).not.toBe(hex(await deriveDatabaseKey(prf())));
	});

	it('gives a key the sealer accepts, and only its own ciphertext opens', async () => {
		const key = await deriveDatabaseKey(prf());
		const sealed = await (await sealer(key)).seal(new TextEncoder().encode('Miete'));

		expect(new TextDecoder().decode(await (await sealer(key)).open(sealed))).toBe('Miete');
		await expect((await sealer(newKey())).open(sealed)).rejects.toThrow();
	});

	it('refuses something that is not a PRF output', async () => {
		await expect(deriveDatabaseKey(new Uint8Array(8))).rejects.toThrow(/PRF output/);
	});

	it('names databases per collection, stably, and without the key in them', async () => {
		const output = prf();
		const key = hex(await deriveDatabaseKey(output));

		const invoices = await deriveDatabaseName(output, 'invoices');
		const again = await deriveDatabaseName(Uint8Array.from(output), 'invoices');
		const customers = await deriveDatabaseName(output, 'customers');

		expect(invoices).toMatch(/^invoice\.invoices\.[0-9a-f]{32}$/);
		expect(again).toBe(invoices);
		expect(customers).not.toBe(invoices);
		expect(key).not.toContain(invoices.split('.')[2]);
	});
});
