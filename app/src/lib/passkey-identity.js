// Ported from Le-Space/belege (app/src/lib/passkey-identity.js) at 9a40d22 and published here
// under the MIT license by its author. Changed: Belege's names (storage paths,
// key info strings, database names) are the invoice app's.
// Ported from Le-Space/simple-todo apps/invoice01 (src/lib/passkey-identity.js) at 56647d5.
// Changed: the credential is always kept (belege has no memory mode), the
// storage key is belege's, and `readPrfOutput` is new — it asks the passkey
// for the PRF output the database key is derived from, and refuses to go on
// without one. Provider bumped from 0.7.0 to 0.8.0 (same API for these calls).
//
// Create-or-recover flow for the WebAuthn passkey identity.
//
// Recovery order:
//   1. this browser's stored credential — no WebAuthn call at all.
//   2. the authenticator alone — two touches, nothing stored anywhere. The
//      provider derives the DID from two signatures (an assertion does not
//      carry the public key) and the signing key from the PRF output, so a
//      device that has never seen this passkey can still be it.
//
// The passkey is bound to the page origin (rpId). A credential created on
// localhost cannot be used on the deployed app or an IPFS gateway.
import { withRestoredSigningKey } from './restored-signing-key.js';
import {
	WebAuthnDIDProvider,
	storeWebAuthnCredential,
	loadWebAuthnCredential,
	clearWebAuthnCredential,
	restoreIdentityFromAuthenticator,
	extractPrfSeedFromCredential,
	prfInputForRelyingParty
} from '@le-space/orbitdb-identity-provider-webauthn-did';

const CREDENTIAL_STORAGE_KEY = 'invoice.webauthnCredential';

/** Thrown when the passkey cannot give a PRF output; the message is for people. */
export class PrfUnavailableError extends Error {
	constructor() {
		super(
			'Dieser Passkey liefert kein PRF-Geheimnis. Die Rechnungs-App verschlüsselt alle Daten mit einem ' +
				'Schlüssel aus diesem Geheimnis und öffnet ohne ihn keine Daten. Bitte einen Passkey ' +
				'in einem Browser und Passwort-Manager mit PRF-Unterstützung verwenden (z. B. aktuelles ' +
				'Chrome, Safari oder Firefox mit iCloud-Schlüsselbund, Google Passwortmanager oder 1Password).'
		);
		this.name = 'PrfUnavailableError';
	}
}

/**
 * Register a brand-new passkey.
 *
 * @param {{ userId: string, displayName: string }} options
 * @returns {Promise<any>} the WebAuthn credential for the identity provider
 */
export async function createPasskeyCredential({ userId, displayName }) {
	const credential = await WebAuthnDIDProvider.createCredential({ userId, displayName });
	storeWebAuthnCredential(credential, CREDENTIAL_STORAGE_KEY);
	return credential;
}

/**
 * What the provider needs, rebuilt from what the authenticator gave back.
 *
 * The constants are the ones `createCredential()` writes for a P-256 passkey
 * (ES256, EC2, P-256). `attestationObject` is empty, because
 * `storeWebAuthnCredential` serialises it and a restored passkey has none.
 * The signing key the restore derived rides along as a non-enumerable
 * property, so no serialiser writes it down.
 *
 * @param {{ did: string, publicKey: { x: Uint8Array, y: Uint8Array },
 *   credentialId: string, rawCredentialId: Uint8Array, prfInput: Uint8Array,
 *   signingKey: Uint8Array }} restored
 */
function credentialFromRestored(restored) {
	return withRestoredSigningKey(
		{
			did: restored.did,
			credentialId: restored.credentialId,
			rawCredentialId: restored.rawCredentialId,
			attestationObject: new Uint8Array(0),
			publicKey: {
				algorithm: -7,
				keyType: 2,
				curve: 1,
				x: restored.publicKey.x,
				y: restored.publicKey.y
			},
			prfInput: restored.prfInput
		},
		restored.signingKey
	);
}

/**
 * The credential kept in this browser, or null. No WebAuthn call.
 *
 * @returns {any | null}
 */
export function loadStoredPasskeyCredential() {
	try {
		return loadWebAuthnCredential(CREDENTIAL_STORAGE_KEY) ?? null;
	} catch {
		return null;
	}
}

/**
 * Recover a passkey identity on a device that has nothing stored: two
 * touches, and no fallback when the authenticator cannot evaluate PRF.
 *
 * @param {{ onTouch?: (step: { touch: number, of: number }) => void }} [options]
 * @returns {Promise<any | null>} the credential, or null when nothing was found
 */
export async function restorePasskeyCredential({ onTouch } = {}) {
	let restored;
	try {
		restored = await restoreIdentityFromAuthenticator({ onTouch });
	} catch (error) {
		if (/** @type {any} */ (error)?.name === 'PrfUnavailableError') throw new PrfUnavailableError();
		console.warn('the authenticator could not answer for an identity:', error);
		return null;
	}

	const credential = credentialFromRestored(restored);
	storeWebAuthnCredential(credential, CREDENTIAL_STORAGE_KEY);
	return credential;
}

/**
 * The passkey's PRF output: one touch.
 *
 * Asked with the same PRF input the identity provider uses (the credential's
 * own, else the fixed per-origin one), so the provider's signing key can be
 * derived from the same answer and OrbitDB does not have to ask again.
 *
 * @param {any} credential
 * @returns {Promise<Uint8Array>}
 * @throws {PrfUnavailableError}
 */
export async function readPrfOutput(credential) {
	// The input is passed explicitly: left to itself, `extractPrfSeedFromCredential`
	// falls back to a *random* input, which would derive a new key every time
	// and lock the books. A refused prompt throws and stays a refusal; only an
	// authenticator that answers without PRF becomes PrfUnavailableError.
	const prfInput = credential?.prfInput ?? (await prfInputForRelyingParty(location.hostname));
	// Cast: the 0.8.0 declaration still says `(credential) => Uint8Array | null`;
	// the code takes options and returns `{ seed, source }`.
	const extract =
		/** @type {(c: any, o: { prfInput: Uint8Array }) => Promise<{ seed: Uint8Array | null }>} */ (
			/** @type {unknown} */ (extractPrfSeedFromCredential)
		);
	const { seed } = await extract(credential, { prfInput });
	if (!(seed instanceof Uint8Array) || seed.length < 32) throw new PrfUnavailableError();
	return seed;
}

/** True when a serialized credential exists in this browser profile. */
export function hasStoredPasskeyCredential() {
	return Boolean(loadStoredPasskeyCredential());
}

/** Remove the locally stored credential (the passkey itself stays on the authenticator). */
export function forgetStoredPasskeyCredential() {
	clearWebAuthnCredential(CREDENTIAL_STORAGE_KEY);
}
