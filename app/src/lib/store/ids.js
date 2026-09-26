// Ported from Le-Space/belege (app/src/lib/store/ids.js) at 9a40d22 and published here
// under the MIT license by its author. Changed: Belege's names (storage paths,
// key info strings, database names) are the invoice app's.
// Record ids: ULIDs (https://github.com/ulid/spec).
//
// 48 bits of milliseconds, then 80 random bits, in Crockford base32, so ids
// sort by creation time as plain strings and two devices writing at the same
// millisecond still do not collide.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * @param {number} [now] milliseconds since the epoch
 * @param {(bytes: Uint8Array) => Uint8Array} [random]
 * @returns {string} 26 characters
 */
export function ulid(now = Date.now(), random = (b) => crypto.getRandomValues(b)) {
	if (!Number.isSafeInteger(now) || now < 0 || now > 2 ** 48 - 1) {
		throw new Error(`Not a ULID timestamp: ${now}`);
	}

	let time = '';
	let t = now;
	for (let i = 0; i < 10; i++) {
		time = ALPHABET[t % 32] + time;
		t = Math.floor(t / 32);
	}

	// 80 bits = 16 characters of 5 bits each.
	const bytes = random(new Uint8Array(10));
	let bits = 0n;
	for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
	let rand = '';
	for (let i = 0; i < 16; i++) {
		rand = ALPHABET[Number(bits & 31n)] + rand;
		bits >>= 5n;
	}

	return time + rand;
}

/** @param {unknown} value */
export function isUlid(value) {
	return typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
