// Ported from Le-Space/belege (app/src/lib/store/sealed-documents.js) at 9a40d22 and published here
// under the MIT license by its author. Changed: Belege's names (storage paths,
// key info strings, database names) are the invoice app's.
// Ported from orbitdb/orbitdb @orbitdb/core 4.0.0 (src/databases/documents.js), MIT.
// Changed: forwards `encryption` (and `onUpdate`) to `Database`, and drops the
// JSDoc examples. Nothing else.
//
// Why this copy exists: in @orbitdb/core 4.0.0 the Documents factory
// destructures its options as `{ …, onUpdate, encrypt }` while `orbitdb.open()`
// passes `encryption`, and `Database` reads `encryption` too. So
//
//   orbitdb.open(name, { type: 'documents', encryption })
//
// silently writes every document in plaintext — no error, no warning. KeyValue
// and Events are not affected. `store.spec.js` reads the raw blocks back to
// prove the payloads here are sealed; drop this file once upstream is fixed
// and that test still passes with the stock `Documents`.

import { Database } from '@orbitdb/core';

const type = 'documents';

/**
 * A documents database that honours the `encryption` option.
 *
 * @param {{ indexBy?: string }} [options]
 */
const SealedDocuments =
	({ indexBy = '_id' } = {}) =>
	async (/** @type {any} */ options) => {
		const database = await Database(options);

		const { addOperation, log } = database;

		/** @param {Record<string, any>} doc */
		const put = async (doc) => {
			const key = doc[indexBy];
			if (!key) throw new Error(`The provided document doesn't contain field '${indexBy}'`);
			return addOperation({ op: 'PUT', key, value: doc });
		};

		/** @param {string} key */
		const del = async (key) => {
			if (!(await get(key))) throw new Error(`No document with key '${key}' in the database`);
			return addOperation({ op: 'DEL', key, value: null });
		};

		/** @param {string} key */
		const get = async (key) => {
			for await (const doc of iterator()) {
				if (key === doc.key) return doc;
			}
		};

		/** @param {(doc: any) => boolean} findFn */
		const query = async (findFn) => {
			const results = [];
			for await (const doc of iterator()) {
				if (findFn(doc.value)) results.push(doc.value);
			}
			return results;
		};

		/** @param {{ amount?: number }} [filters] */
		const iterator = async function* ({ amount = -1 } = {}) {
			/** @type {Record<string, boolean>} */
			const keys = {};
			let count = 0;
			for await (const entry of log.iterator()) {
				const { op, key, value } = entry.payload;
				if (op === 'PUT' && !keys[key]) {
					keys[key] = true;
					count++;
					yield { hash: entry.hash, key, value };
				} else if (op === 'DEL' && !keys[key]) {
					keys[key] = true;
				}
				if (amount > -1 && count >= amount) break;
			}
		};

		const all = async () => {
			const values = [];
			for await (const entry of iterator()) values.unshift(entry);
			return values;
		};

		return { ...database, type, put, del, get, iterator, query, indexBy, all };
	};

SealedDocuments.type = type;

export default SealedDocuments;
