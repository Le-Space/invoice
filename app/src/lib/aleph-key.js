// The books' Aleph key, as bytes: made and checked without any curve code, so
// that unlocking the books (books-vault.js) loads none. Its address and its
// signature are in aleph-signer.js, loaded only where a backup is made.
//
// A secp256k1 secret is 32 bytes read as a big-endian number k with
// 0 < k < n, n being the order of the curve's group (SEC 2, 2.4.1).

/** The order of secp256k1's group, big-endian. */
const ORDER = Uint8Array.from(
	'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'.match(/../g) ?? [],
	(h) => parseInt(h, 16)
);

/**
 * Is this a key: 32 bytes, not zero, below the curve order?
 *
 * @param {unknown} key
 * @returns {key is Uint8Array}
 */
export function isAlephKey(key) {
	if (!(key instanceof Uint8Array) || key.length !== 32) return false;
	if (key.every((b) => b === 0)) return false;
	for (let i = 0; i < 32; i++) {
		if (key[i] !== ORDER[i]) return key[i] < ORDER[i];
	}
	return false; // equal to the order
}

/**
 * A fresh key: 32 random bytes that are a valid secp256k1 secret. A draw at
 * or above the order happens about once in 2^128 tries; it is drawn again.
 *
 * @returns {Uint8Array}
 */
export function newAlephKey() {
	for (;;) {
		const key = crypto.getRandomValues(new Uint8Array(32));
		if (isAlephKey(key)) return key;
	}
}
