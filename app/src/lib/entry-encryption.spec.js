// Ported from Le-Space/belege (app/src/lib/entry-encryption.spec.js) at 9a40d22 and published here
// under the MIT license by its author. Changed: Belege's names (storage paths,
// key info strings, database names) are the invoice app's.
// Ported from Le-Space/simple-todo apps/invoice01 (src/lib/entry-encryption.spec.js) at 56647d5.
// Changed: the two migration tests became one that proves an unsealed payload
// is refused; the payload is a bank transaction instead of a todo.
import { describe, expect, it } from 'vitest';

import * as dagCbor from '@ipld/dag-cbor';
import * as Block from 'multiformats/block';
import { sha256 } from 'multiformats/hashes/sha2';

import { newKey, sealer } from './db-encryption.js';
import { payloadEncryption } from './entry-encryption.js';

/** @param {string} text */
const bytes = (text) => new TextEncoder().encode(text);
/** @param {Uint8Array} value */
const text = (value) => new TextDecoder().decode(value);

/**
 * What OrbitDB does with whatever `decrypt` returns: `entry.js` hands the
 * bytes straight to `Block.decode` and uses the `.value`.
 *
 * @param {Uint8Array} decrypted
 */
const asOrbitDbReadsIt = async (decrypted) =>
	(await Block.decode({ bytes: decrypted, codec: dagCbor, hasher: sha256 })).value;

/** A payload shaped the way the documents store writes one. */
const payload = {
	op: 'PUT',
	key: '01J8Z3Q4X5Y6Z7A8B9C0D1E2F3',
	value: {
		id: '01J8Z3Q4X5Y6Z7A8B9C0D1E2F3',
		counterparty: 'Stadtwerke Musterstadt',
		amountCents: -5259,
		deleted: false
	}
};

describe('entry-encryption', () => {
	it('seals and opens what OrbitDB hands it', async () => {
		const { data } = await payloadEncryption(newKey());
		const sealed = await data.encrypt(bytes('milk'));

		expect(sealed).not.toEqual(bytes('milk'));
		expect(text(await data.decrypt(sealed))).toBe('milk');
	});

	it('returns a real entry payload unchanged through the round trip', async () => {
		const { data } = await payloadEncryption(newKey());
		const encoded = await Block.encode({ value: payload, codec: dagCbor, hasher: sha256 });

		const sealed = await data.encrypt(encoded.bytes);

		expect(text(sealed)).not.toContain('Stadtwerke');
		expect(await asOrbitDbReadsIt(await data.decrypt(sealed))).toEqual(payload);
	});

	it('refuses a payload that was never sealed', async () => {
		// invoice01 reads these as entries from before encryption. belege has no
		// such entries, so accepting one would let anybody who can append to the
		// log slip in plaintext that the app then shows as genuine.
		const { data } = await payloadEncryption(newKey());

		await expect(data.decrypt(payload)).rejects.toThrow(/unencrypted/);
	});

	it('refuses a sealed payload under the wrong key', async () => {
		const encoded = await Block.encode({ value: payload, codec: dagCbor, hasher: sha256 });
		const sealed = await (await sealer(newKey())).seal(encoded.bytes);
		const { data } = await payloadEncryption(newKey());

		await expect(data.decrypt(sealed)).rejects.toThrow();
	});
});
