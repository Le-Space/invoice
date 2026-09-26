// Ported from Le-Space/belege (app/src/lib/store/repository.js) at 9a40d22 and published here
// under the MIT license by its author. Changed: Belege's names (storage paths,
// key info strings, database names) are the invoice app's; the collections are an invoice's.
// The data layer: one sealed OrbitDB documents database per collection.
//
// Every record carries
//   id         a ULID, so ids sort by creation time
//   createdAt  ISO 8601, set once
//   updatedAt  ISO 8601, set on every write
//   deleted    soft delete; bookkeeping records are never removed, and an
//              append-only log could not remove them anyway
//   author     the DID of the identity that wrote this version
// and keeps money in integer cents: any field whose name ends in `Cents`
// must be a safe integer.
//
// The databases are opened with `payloadEncryption` and nothing else; there
// is no code path that opens one in plaintext.

import { payloadEncryption } from '../entry-encryption.js';
import { deriveDatabaseName } from '../database-keys.js';
import { ulid, isUlid } from './ids.js';
import SealedDocuments from './sealed-documents.js';

export const COLLECTIONS = /** @type {const} */ (['invoices', 'customers', 'settings']);

/** @typedef {typeof COLLECTIONS[number]} CollectionName */

/**
 * @typedef {{ id: string, createdAt: string, updatedAt: string, deleted: boolean, author: string } & Record<string, any>} StoredRecord
 */

/**
 * @typedef {object} Collection
 * @property {CollectionName} name
 * @property {string} address the OrbitDB address
 * @property {(record: Record<string, any>) => Promise<StoredRecord>} put create, or update when `id` exists
 * @property {(id: string) => Promise<StoredRecord | null>} get
 * @property {(filter?: { includeDeleted?: boolean, where?: (record: StoredRecord) => boolean }) => Promise<StoredRecord[]>} list newest first
 * @property {(id: string) => Promise<StoredRecord>} softDelete
 * @property {(listener: (event: { collection: CollectionName }) => void) => () => void} onChange returns an unsubscribe
 */

/** @param {Record<string, any>} record */
function assertCents(record) {
	for (const [field, value] of Object.entries(record)) {
		if (field.endsWith('Cents') && value !== null && value !== undefined) {
			if (!Number.isSafeInteger(value)) {
				throw new Error(`${field} must be an integer amount of cents, got ${value}`);
			}
		}
	}
}

/**
 * @param {any} db an opened SealedDocuments database, indexed by `id`
 * @param {CollectionName} name
 * @param {{ author: string, now?: () => Date }} context
 * @returns {Collection}
 */
export function createCollection(db, name, { author, now = () => new Date() }) {
	/** @param {string} id */
	async function get(id) {
		const found = await db.get(id);
		return found ? /** @type {StoredRecord} */ (found.value) : null;
	}

	/** @param {Record<string, any>} input */
	async function put(input) {
		if (!input || typeof input !== 'object') throw new Error('A record must be an object.');
		assertCents(input);

		const at = now().toISOString();
		const existing = input.id ? await get(input.id) : null;
		if (input.id && !existing && !isUlid(input.id)) {
			throw new Error(`Not a record id: ${input.id}`);
		}

		/** @type {StoredRecord} */
		const record = {
			...existing,
			...input,
			id: existing?.id ?? input.id ?? ulid(now().getTime()),
			createdAt: existing?.createdAt ?? at,
			updatedAt: at,
			deleted: input.deleted ?? existing?.deleted ?? false,
			author
		};
		await db.put(record);
		return record;
	}

	/** @type {Collection['list']} */
	async function list({ includeDeleted = false, where } = {}) {
		const all = await db.all();
		return all
			.map((/** @type {{ value: StoredRecord }} */ entry) => entry.value)
			.filter((/** @type {StoredRecord} */ record) => includeDeleted || !record.deleted)
			.filter((/** @type {StoredRecord} */ record) => !where || where(record))
			.sort((/** @type {StoredRecord} */ a, /** @type {StoredRecord} */ b) =>
				a.id < b.id ? 1 : a.id > b.id ? -1 : 0
			);
	}

	/** @param {string} id */
	async function softDelete(id) {
		const existing = await get(id);
		if (!existing) throw new Error(`No ${name} record with id ${id}`);
		return put({ ...existing, deleted: true });
	}

	/** @type {Collection['onChange']} */
	function onChange(listener) {
		const handler = () => listener({ collection: name });
		db.events.on('update', handler);
		return () => db.events.off('update', handler);
	}

	return { name, address: db.address?.toString?.() ?? '', put, get, list, softDelete, onChange };
}

/**
 * Open every collection, sealed with one key.
 *
 * @param {object} params
 * @param {any} params.orbitdb a started OrbitDB instance
 * @param {Uint8Array} params.encryptionKey 32 bytes from `deriveDatabaseKey`
 * @param {Uint8Array} params.prfOutput names the databases, see `deriveDatabaseName`
 * @param {Record<string, any>} [params.openOptions] extra `orbitdb.open` options (tests pass memory storages)
 * @returns {Promise<{ invoices: Collection, customers: Collection, settings: Collection, close: () => Promise<void> }>}
 */
export async function openStore({ orbitdb, encryptionKey, prfOutput, openOptions = {} }) {
	if (!(encryptionKey instanceof Uint8Array) || encryptionKey.length !== 32) {
		throw new Error('The store cannot be opened without its 32-byte encryption key.');
	}
	const author = orbitdb.identity.id;
	const encryption = await payloadEncryption(encryptionKey);

	/** @type {Record<string, any>} */
	const dbs = {};
	/** @type {Record<string, Collection>} */
	const collections = {};
	for (const name of COLLECTIONS) {
		dbs[name] = await orbitdb.open(await deriveDatabaseName(prfOutput, name), {
			type: SealedDocuments.type,
			Database: SealedDocuments({ indexBy: 'id' }),
			encryption,
			...(typeof openOptions === 'function' ? await openOptions(name) : openOptions)
		});
		collections[name] = createCollection(dbs[name], name, { author });
	}

	return {
		invoices: collections.invoices,
		customers: collections.customers,
		settings: collections.settings,
		async close() {
			await Promise.allSettled(Object.values(dbs).map((db) => db.close()));
		}
	};
}
