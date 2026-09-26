// Ported from Le-Space/belege (app/src/lib/database-keys.js) at 9a40d22 and published here
// under the MIT license by its author. Changed: Belege's names (storage paths,
// key info strings, database names) are the invoice app's; no key for receipt files.
// Ported from Le-Space/simple-todo apps/invoice01 (src/lib/database-keys.js) at 56647d5.
// Changed: rewritten to what that file and invoice01's docs/invoicing.md
// ("Not sealed yet — and the way it will be is decided") plan as its Phase 2.
// invoice01 still keeps one random key per database in local storage; here
// the key is derived from the passkey's PRF output and never stored at all.
//
// Where a database key comes from.
//
// The passkey that is the identity also answers a PRF (WebAuthn `prf`
// extension, CTAP `hmac-secret`) question with 32 secret bytes. The same
// passkey asked the same question answers the same bytes on every device it
// is synced to, and nothing else can produce them. From that one secret this
// module derives, with HKDF-SHA-256 and a distinct `info` string per purpose:
//
//   - the AES-GCM key every OrbitDB database is sealed with
//     (`invoice/db-key/v1`), and
//   - the database names (`invoice/db-name/v1:<collection>`), so that an
//     address cannot be guessed from the DID alone, and
//
// The identity provider derives its OrbitDB signing key from the same PRF
// output under its own info string; HKDF with different info strings yields
// independent keys, so one secret serves all of them without one revealing
// another.
//
// Nothing derived here is written anywhere. A reload asks the passkey again.

/** Bumping this rotates every database key: existing data becomes unreadable. */
export const DB_KEY_INFO = 'invoice/db-key/v1';

/** Bumping this renames every database: existing data is no longer found. */
export const DB_NAME_INFO = 'invoice/db-name/v1';

/**
 * Bumping this gives the app another libp2p peer id: every paired app would
 * have to pair again.
 */
export const PEER_KEY_INFO = 'invoice/peer-key/v1';

const KEY_BYTES = 32;
const NAME_BYTES = 16;

/**
 * HKDF-SHA-256 with an empty salt: the input is already uniformly random
 * (a PRF output), so the extract step needs no salt to be sound.
 *
 * @param {Uint8Array} secret
 * @param {string} info
 * @param {number} length in bytes
 * @returns {Promise<Uint8Array>}
 */
async function hkdf(secret, info, length) {
	const base = await crypto.subtle.importKey(
		'raw',
		/** @type {BufferSource} */ (secret),
		'HKDF',
		false,
		['deriveBits']
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new Uint8Array(0),
			info: new TextEncoder().encode(info)
		},
		base,
		length * 8
	);
	return new Uint8Array(bits);
}

/** @param {Uint8Array} prfOutput */
function assertPrfOutput(prfOutput) {
	if (!(prfOutput instanceof Uint8Array) || prfOutput.length < 32) {
		throw new Error('A PRF output of at least 32 bytes is required.');
	}
}

/**
 * The AES-GCM key for the invoice app's databases.
 *
 * @param {Uint8Array} prfOutput the passkey's PRF result
 * @param {string} [info] only for tests and a future key rotation
 * @returns {Promise<Uint8Array>} 32 bytes, for `payloadEncryption`
 */
export async function deriveDatabaseKey(prfOutput, info = DB_KEY_INFO) {
	assertPrfOutput(prfOutput);
	return hkdf(prfOutput, info, KEY_BYTES);
}

/**
 * The OrbitDB name of one collection, e.g. `invoice.invoices.9f3c…`.
 *
 * The collection stays readable so a person inspecting IndexedDB can tell
 * the databases apart; the suffix is what nobody without the passkey can
 * compute.
 *
 * @param {Uint8Array} prfOutput
 * @param {string} collection
 * @returns {Promise<string>}
 */
export async function deriveDatabaseName(prfOutput, collection) {
	assertPrfOutput(prfOutput);
	if (!/^[a-z][a-z0-9-]*$/.test(collection)) {
		throw new Error(`Not a collection name: ${collection}`);
	}
	const suffix = await hkdf(prfOutput, `${DB_NAME_INFO}:${collection}`, NAME_BYTES);
	return `invoice.${collection}.${Array.from(suffix, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The seed of the app's libp2p peer key (Ed25519), for UCEP.
 *
 * A paired app finds this one by its peer id and keeps its grant under it, so
 * the id has to stay the same from one unlock to the next — and on every
 * device the passkey is synced to. It is derived like every other key here,
 * under its own info string, and never written anywhere.
 *
 * @param {Uint8Array} prfOutput
 * @param {string} [info]
 * @returns {Promise<Uint8Array>} 32 bytes
 */
export async function derivePeerKeySeed(prfOutput, info = PEER_KEY_INFO) {
	assertPrfOutput(prfOutput);
	return hkdf(prfOutput, info, KEY_BYTES);
}
