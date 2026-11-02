// Ported from Le-Space/belege (app/src/lib/passkey-identity.js) at 9a40d22 and published here
// under the MIT license by its author. Changed: Belege's names (storage paths,
// key info strings, database names) are the invoice app's.
// Ported from Le-Space/simple-todo apps/invoice01 (src/lib/passkey-identity.js) at 56647d5.
// Changed: the credential is always kept (belege has no memory mode), the
// storage key is belege's, and `readPrfOutput` is new — it asks the passkey
// for the PRF output the database key is derived from, and refuses to go on
// without one. Provider bumped from 0.7.0 to 0.8.0 (same API for these calls).
// Provider 0.12.2: `readPrfOutput` asks through the provider's own, which names
// the passkey it asks and refuses another passkey's answer.
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
	readPrfOutput as askPrfOutput,
	PrfUnavailableError as NoPrfOutputError,
	WebAuthnAuthenticationError
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

/** Thrown when another passkey answered than the one asked; the message is for people. */
export class OtherPasskeyError extends Error {
	constructor() {
		super(
			'Geantwortet hat ein anderer Passkey als der, nach dem gefragt wurde. Mit seiner Antwort ' +
				'wurde nichts geöffnet und nichts versiegelt. Bitte noch einmal versuchen und den Passkey ' +
				'bestätigen, nach dem gefragt wird.'
		);
		this.name = 'OtherPasskeyError';
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
 * The request names this credential, and another passkey's answer is refused:
 * its PRF output looks as right as the asked one's, and a vault slot sealed
 * with it opens for the other passkey only. Before provider 0.12.2 this read
 * went through `extractPrfSeedFromCredential`, whose `discoverableCredentials:
 * undefined` counted as off, so the request named the credential by accident;
 * the answer was taken from whichever passkey gave it.
 *
 * @param {any} credential
 * @returns {Promise<Uint8Array>}
 * @throws {PrfUnavailableError}
 * @throws {OtherPasskeyError}
 */
export async function readPrfOutput(credential) {
	// The provider never asks a random question, whose answer would derive a new
	// key every time and lock the books. A refused prompt throws and stays a
	// refusal; only an authenticator that answers without PRF becomes
	// PrfUnavailableError.
	try {
		return await askPrfOutput(credential);
	} catch (error) {
		if (error instanceof NoPrfOutputError) throw new PrfUnavailableError();
		if (error instanceof WebAuthnAuthenticationError) throw new OtherPasskeyError();
		throw error;
	}
}

/** True when a serialized credential exists in this browser profile. */
export function hasStoredPasskeyCredential() {
	return Boolean(loadStoredPasskeyCredential());
}

/** Remove the locally stored credential (the passkey itself stays on the authenticator). */
export function forgetStoredPasskeyCredential() {
	clearWebAuthnCredential(CREDENTIAL_STORAGE_KEY);
}
