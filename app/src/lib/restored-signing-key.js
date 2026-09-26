// Ported from Le-Space/belege (app/src/lib/restored-signing-key.js) at 9a40d22 and published here
// under the MIT license by its author. Changed: Belege's names (storage paths,
// key info strings, database names) are the invoice app's.
// Ported from Le-Space/simple-todo packages/todo (src/restored-signing-key.js) at 56647d5.
// Changed: `seedRestoredSigningKey` is gone. belege never keeps a keystore
// across sessions, so node.js puts the key (restored or derived) into a fresh
// session-only keystore directly, see session-identities.js.
//
/**
 * A passkey restored on this device brings its OrbitDB signing key with it.
 *
 * `restoreIdentityFromAuthenticator()` reads the passkey's PRF output in its
 * first touch and derives the signing key from it. The provider, left to
 * itself, derives that same key again when OrbitDB asks for the identity — and
 * to do so it asks the passkey for the PRF output once more: a touch that
 * yields nothing new. Put into the keystore first, the key is simply there
 * (`ensureDerivedSigningKey` finds it and leaves it alone), and a restore
 * costs three touches instead of four: two to restore, one to sign the
 * identity.
 *
 * The chapters carry the key on the credential as a non-enumerable property,
 * so no serialiser writes it down: `storeWebAuthnCredential` spreads the
 * credential, and a spread copies only what is enumerable.
 */

/**
 * Attach a restored signing key so it travels with the credential in memory
 * only.
 *
 * @template {object} T
 * @param {T} credential
 * @param {Uint8Array | undefined} signingKey
 * @returns {T}
 */
export function withRestoredSigningKey(credential, signingKey) {
	if (signingKey instanceof Uint8Array) {
		Object.defineProperty(credential, 'signingKey', { value: signingKey, enumerable: false });
	}
	return credential;
}
