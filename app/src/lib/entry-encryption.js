// Ported from Le-Space/belege (app/src/lib/entry-encryption.js) at 9a40d22 and published here
// under the MIT license by its author. Changed: Belege's names (storage paths,
// key info strings, database names) are the invoice app's.
// Ported from Le-Space/simple-todo apps/invoice01 (src/lib/entry-encryption.js) at 56647d5.
// Changed: the plaintext migration is gone. invoice01 hands back entries that
// were written before its list was sealed; belege has never written a
// plaintext entry, so an unsealed payload here can only be a mistake or a
// forgery, and it is refused instead of read.
//
// The seam between sealed bytes and an OrbitDB log.
//
// OrbitDB takes `encryption: { data: { encrypt, decrypt } }` and applies it to
// an entry's payload: `entry.js` encodes the payload to dag-cbor, hands the
// bytes to `encrypt`, and on the way back hands whatever it stored to
// `decrypt` and decodes the result. So both halves speak bytes, and the
// cryptography itself stays in ./db-encryption.js where it can be proven on
// its own.

import { sealer } from './db-encryption.js';

/**
 * OrbitDB's `encryption` option for one database.
 *
 * @param {Uint8Array} rawKey 32 bytes, see ./database-keys.js
 * @returns {Promise<{ data: { encrypt: (bytes: Uint8Array) => Promise<Uint8Array>, decrypt: (value: any) => Promise<Uint8Array> } }>}
 */
export async function payloadEncryption(rawKey) {
	const seal = await sealer(rawKey);

	return {
		data: {
			encrypt: (bytes) => seal.seal(bytes),

			/** @param {any} value the stored payload, sealed bytes and nothing else */
			async decrypt(value) {
				if (!(value instanceof Uint8Array)) {
					throw new Error('Refusing an unencrypted entry: every invoice entry is sealed.');
				}
				return seal.open(value);
			}
		}
	};
}
