// Where the provider keeps its grants and invitations: in the sealed
// `settings` collection, one record per entry, so a pairing survives a reload
// (ucep-auth.md §11) and nobody without the passkey can read it.

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
	/** @param {string} key */
	const find = async (key) => {
		const [record] = await collection.list({ where: (r) => r.key === `${prefix}${key}` });
		return record ?? null;
	};
	return {
		async get(key) {
			return (await find(key))?.value ?? undefined;
		},
		async set(key, value) {
			const record = await find(key);
			await collection.put({ ...(record ?? {}), key: `${prefix}${key}`, value });
		},
		async delete(key) {
			const record = await find(key);
			if (record) await collection.softDelete(record.id);
		},
		async values() {
			const records = await collection.list({
				where: (r) => typeof r.key === 'string' && r.key.startsWith(prefix)
			});
			return records.map((r) => r.value);
		}
	};
}
