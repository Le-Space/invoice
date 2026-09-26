// Ported from Le-Space/belege (app/src/lib/store/settings.js) at 9a40d22 and published here
// under the MIT license by its author. Changed: Belege's names (storage paths,
// key info strings, database names) are the invoice app's.
// Settings: small records in the sealed `settings` collection, one per key.
// The bridge token lives here, never in localStorage.

/**
 * @param {import('./repository.js').Collection} settings
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function getSetting(settings, key) {
	const [record] = await settings.list({ where: (r) => r.key === key });
	return record?.value ?? null;
}

/**
 * @param {import('./repository.js').Collection} settings
 * @param {string} key
 * @param {unknown} value `null` clears it
 */
export async function setSetting(settings, key, value) {
	const [record] = await settings.list({ where: (r) => r.key === key });
	return settings.put({ ...(record ?? {}), key, value });
}
