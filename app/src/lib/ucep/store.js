// Where the provider keeps its grants and invitations: in the sealed
// `settings` collection, one record per entry, so a pairing survives a reload
// (ucep-auth.md §11) and nobody without the passkey can read it.
//
// The settings are an append-only log, and a lookup reads all of it. So the
// entries are kept in memory until the collection changes, and a grant's
// `lastUsedAt`, which the library notes after every command, is written at
// most once an hour: otherwise every command would add an entry for good.

/** How often a grant's `lastUsedAt` alone is written. */
export const LAST_USED_EVERY_MS = 60 * 60 * 1000;

/**
 * Whether `next` differs from `stored` only by a `lastUsedAt` less than an
 * hour newer: not worth an entry in the log.
 *
 * @param {any} stored
 * @param {any} next
 */
export function onlyRecentlyUsed(stored, next) {
	if (!stored || !next || typeof stored !== 'object' || typeof next !== 'object') return false;
	if (typeof stored.lastUsedAt !== 'number' || typeof next.lastUsedAt !== 'number') return false;
	if (next.lastUsedAt - stored.lastUsedAt >= LAST_USED_EVERY_MS) return false;
	return (
		JSON.stringify({ ...stored, lastUsedAt: 0 }) === JSON.stringify({ ...next, lastUsedAt: 0 })
	);
}

/**
 * A key-value store as @le-space/ucep asks for one (store.js `KeyValue`), on
 * the records of a collection whose `key` starts with `prefix`.
 *
 * @template T
 * @param {import('../store/repository.js').Collection} collection
 * @param {string} prefix e.g. `ucep/grant/`
 * @returns {{ get: (key: string) => Promise<T | undefined>, set: (key: string, value: T) => Promise<void>, delete: (key: string) => Promise<void>, values: () => Promise<T[]> }}
 */
export function collectionKeyValue(collection, prefix) {
	/** @type {Promise<Map<string, any>> | null} the live records under `prefix`, by key */
	let cached = null;
	collection.onChange(() => {
		cached = null;
	});
	const records = () => {
		if (!cached) {
			const reading = collection
				.list({ where: (r) => typeof r.key === 'string' && r.key.startsWith(prefix) })
				.then((list) => {
					/** @type {Map<string, any>} */
					const byKey = new Map();
					// Newest first: the first record of a key is the one that counts.
					for (const r of list) if (!byKey.has(r.key)) byKey.set(r.key, r);
					return byKey;
				});
			cached = reading;
			reading.catch(() => {
				if (cached === reading) cached = null;
			});
		}
		return cached;
	};
	/** @param {string} key */
	const find = async (key) => (await records()).get(`${prefix}${key}`) ?? null;
	return {
		async get(key) {
			return (await find(key))?.value ?? undefined;
		},
		async set(key, value) {
			// The sealed log stores dag-cbor, which has no `undefined`: a field the
			// library left undefined (approve without fewer scopes) is dropped.
			value = JSON.parse(JSON.stringify(value));
			const record = await find(key);
			if (record && onlyRecentlyUsed(record.value, value)) return;
			await collection.put({ ...(record ?? {}), key: `${prefix}${key}`, value });
			cached = null;
		},
		async delete(key) {
			const record = await find(key);
			if (record) await collection.softDelete(record.id);
			cached = null;
		},
		async values() {
			return [...(await records()).values()].map((r) => r.value);
		}
	};
}
