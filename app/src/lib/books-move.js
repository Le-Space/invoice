// Moving the books to an identity of their own — once, on the first unlock
// after this update.
//
// Until now every collection was opened with OrbitDB's default access
// controller: an IPFSAccessController whose write list is the DID of the
// passkey that made the books, fixed in the address. A second key could be
// given the database key, but never become a writer there, and a lost key
// could never be removed. So the books get an identity of their own — a secret
// in the vault, made into a signer with `createSecretSigner` — and every
// collection is opened anew, under the same name, with an
// OrbitDBAccessController rooted at that identity. That is a new address.
//
// The move copies every record in its latest state, byte for byte, and then
// compares both sides record by record; only a complete copy is reported. The
// caller switches over by writing the result into the vault. The old databases
// stay where they are, with the history of every record. They are opened here
// with their own access controller, which this identity is not in, so nothing
// can write to them again.

import { IPFSAccessController, OrbitDBAccessController } from '@orbitdb/core';
import { payloadEncryption } from './entry-encryption.js';
import SealedDocuments from './store/sealed-documents.js';
import { COLLECTIONS } from './store/repository.js';

/** The settings record the move is written down in. */
export const MOVE_RECORD_KEY = 'books/moved/v1';

/**
 * A record as a string that is the same for the same content, whatever the
 * order of its fields.
 *
 * @param {unknown} value
 * @returns {string}
 */
function canonical(value) {
	return JSON.stringify(value, (_key, inner) =>
		inner && typeof inner === 'object' && !Array.isArray(inner)
			? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
			: inner
	);
}

/**
 * The access controller the books' collections are opened with from now on:
 * the books' identity is the root, the one writer that may grant others.
 *
 * @param {string} booksDid
 */
export function booksAccessController(booksDid) {
	return OrbitDBAccessController({ write: [booksDid] });
}

/**
 * Copy every collection from the databases the passkey `formerWriter` wrote to
 * the books' own, and check the copy.
 *
 * Can run again after an interruption: what is already there and the same is
 * left alone.
 *
 * @param {object} params
 * @param {any} params.orbitdb a started OrbitDB whose identity is the books'
 * @param {Record<typeof COLLECTIONS[number], string>} params.names from the vault
 * @param {Uint8Array} params.encryptionKey from the vault
 * @param {string} params.formerWriter the DID the old collections were written by
 * @param {(collection: string, side: 'old' | 'new') => Promise<Record<string, any>>} [params.openOptions]
 *   extra `orbitdb.open` options per database (tests pass memory storages)
 * @returns {Promise<{ from: Record<string, string>, to: Record<string, string>, copied: Record<string, number>, records: Record<string, number> }>}
 * @throws {Error} when a record does not arrive as it left; nothing is switched then
 */
export async function moveBooks({ orbitdb, names, encryptionKey, formerWriter, openOptions }) {
	if (typeof formerWriter !== 'string' || !formerWriter) {
		throw new Error('The move needs the DID the books were written by.');
	}
	const encryption = await payloadEncryption(encryptionKey);
	const booksDid = orbitdb.identity.id;
	/** @type {Record<string, string>} */ const from = {};
	/** @type {Record<string, string>} */ const to = {};
	/** @type {Record<string, number>} */ const copied = {};
	/** @type {Record<string, number>} */ const records = {};

	for (const name of COLLECTIONS) {
		/** @param {'old' | 'new'} side @param {any} AccessController */
		const open = async (side, AccessController) =>
			orbitdb.open(names[name], {
				type: SealedDocuments.type,
				Database: SealedDocuments({ indexBy: 'id' }),
				encryption,
				AccessController,
				...(openOptions ? await openOptions(name, side) : {})
			});
		// The access controller the old collections were made with, spelled out:
		// the same write list gives the same manifest, and so the same address.
		const old = await open('old', IPFSAccessController({ write: [formerWriter] }));
		const target = await open('new', booksAccessController(booksDid));
		try {
			const source = (await old.all()).map((/** @type {any} */ entry) => entry.value);
			/** @param {any} db */
			const byId = async (db) =>
				new Map(
					(await db.all())
						.map((/** @type {any} */ entry) => entry.value)
						// The move's own record is written to the new settings only.
						.filter((/** @type {any} */ record) => record?.key !== MOVE_RECORD_KEY)
						.map((/** @type {any} */ record) => [record.id, canonical(record)])
				);

			const present = await byId(target);
			let n = 0;
			for (const record of source) {
				if (present.get(record.id) === canonical(record)) continue;
				await target.put(record);
				n += 1;
			}

			const arrived = await byId(target);
			for (const record of source) {
				if (arrived.get(record.id) !== canonical(record)) {
					throw new Error(`The ${name} did not move completely: record ${record.id} differs.`);
				}
			}
			if (arrived.size !== source.length) {
				throw new Error(
					`The ${name} did not move cleanly: ${arrived.size} records arrived for ${source.length}.`
				);
			}

			from[name] = old.address.toString();
			to[name] = target.address.toString();
			copied[name] = n;
			records[name] = source.length;
		} finally {
			await target.close();
			await old.close();
		}
	}

	return { from, to, copied, records };
}
