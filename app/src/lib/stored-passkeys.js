// The passkeys this browser can unlock the books with.
//
// The first is kept where it always was (passkey-identity.js,
// `invoice.webauthnCredential`), so existing installs unlock as before, and it
// stays the one the unlock button uses. Every passkey added later — a second
// security key — is kept next to it under a key of its own, with the label it
// was given, and `invoice.passkeys.v1` lists those. Whichever passkey unlocked
// last becomes the default.
//
// What is kept is what the provider stores for a credential anyway: its id,
// public key and PRF input. Nothing here is secret; the books open only with
// the passkey itself.

import {
	clearWebAuthnCredential,
	loadWebAuthnCredential,
	storeWebAuthnCredential
} from '@le-space/orbitdb-identity-provider-webauthn-did';

/** Where the first passkey has always been kept (passkey-identity.js). */
export const DEFAULT_PASSKEY_KEY = 'invoice.webauthnCredential';

/** The list of the other passkeys: `[{ credentialId, label, addedAt }]`. */
export const PASSKEYS_INDEX_KEY = 'invoice.passkeys.v1';

/** @param {string} credentialId */
const storageKeyFor = (credentialId) => `${DEFAULT_PASSKEY_KEY}.${credentialId}`;

/**
 * @typedef {object} StoredPasskey
 * @property {string} credentialId base64url
 * @property {string} label what the person called it
 * @property {any} credential what the provider needs to unlock with it
 * @property {boolean} isDefault the one the unlock button uses
 */

/** @returns {{ credentialId: string, label: string, addedAt: string }[]} */
function readIndex() {
	try {
		const parsed = JSON.parse(localStorage.getItem(PASSKEYS_INDEX_KEY) ?? '[]');
		return Array.isArray(parsed)
			? parsed.filter((entry) => typeof entry?.credentialId === 'string')
			: [];
	} catch {
		return [];
	}
}

/** @param {{ credentialId: string, label: string, addedAt: string }[]} index */
function writeIndex(index) {
	if (index.length === 0) localStorage.removeItem(PASSKEYS_INDEX_KEY);
	else localStorage.setItem(PASSKEYS_INDEX_KEY, JSON.stringify(index));
}

/** @param {any} credential @param {string} [fallback] */
const labelOf = (credential, fallback = 'Passkey') =>
	(typeof credential?.displayName === 'string' && credential.displayName.trim()) || fallback;

/** @param {string} key */
function load(key) {
	try {
		return loadWebAuthnCredential(key) ?? null;
	} catch {
		return null;
	}
}

/**
 * Every passkey this browser keeps, the default first.
 *
 * @returns {StoredPasskey[]}
 */
export function listStoredPasskeys() {
	/** @type {StoredPasskey[]} */
	const found = [];
	const first = load(DEFAULT_PASSKEY_KEY);
	if (first) {
		found.push({
			credentialId: first.credentialId,
			label: labelOf(first),
			credential: first,
			isDefault: true
		});
	}
	for (const entry of readIndex()) {
		if (found.some((p) => p.credentialId === entry.credentialId)) continue;
		const credential = load(storageKeyFor(entry.credentialId));
		if (!credential) continue;
		found.push({
			credentialId: entry.credentialId,
			label: entry.label || labelOf(credential),
			credential,
			isDefault: false
		});
	}
	return found;
}

/**
 * Keep a passkey that was just added to the books, under the label it was
 * given.
 *
 * @param {any} credential from `WebAuthnDIDProvider.createCredential`
 * @param {string} label
 */
export function rememberPasskey(credential, label) {
	const credentialId = credential?.credentialId;
	if (typeof credentialId !== 'string' || !credentialId) {
		throw new Error('A passkey without a credential id cannot be kept.');
	}
	if (listStoredPasskeys().some((p) => p.credentialId === credentialId)) return;
	storeWebAuthnCredential(credential, storageKeyFor(credentialId));
	writeIndex([
		...readIndex(),
		{ credentialId, label: label.trim() || labelOf(credential), addedAt: new Date().toISOString() }
	]);
}

/**
 * Let the unlock button use this passkey from now on: the one that unlocked
 * last. The one it replaces moves into the list, label and all.
 *
 * @param {string} credentialId
 */
export function makeDefaultPasskey(credentialId) {
	const all = listStoredPasskeys();
	const chosen = all.find((p) => p.credentialId === credentialId);
	const current = all.find((p) => p.isDefault);
	if (!chosen || chosen.isDefault) return;

	const index = readIndex().filter(
		(entry) => entry.credentialId !== credentialId && entry.credentialId !== current?.credentialId
	);
	if (current) {
		storeWebAuthnCredential(current.credential, storageKeyFor(current.credentialId));
		index.push({
			credentialId: current.credentialId,
			label: current.label,
			addedAt: new Date().toISOString()
		});
	}
	storeWebAuthnCredential(chosen.credential, DEFAULT_PASSKEY_KEY);
	clearWebAuthnCredential(storageKeyFor(credentialId));
	writeIndex(index);
}

/**
 * Forget a passkey in this browser. If it was the default, the next one takes
 * its place. The passkey itself stays on its authenticator.
 *
 * @param {string} credentialId
 */
export function forgetPasskey(credentialId) {
	const all = listStoredPasskeys();
	const gone = all.find((p) => p.credentialId === credentialId);
	if (!gone) return;
	if (gone.isDefault) {
		const next = all.find((p) => !p.isDefault);
		if (next) makeDefaultPasskey(next.credentialId);
		else {
			clearWebAuthnCredential(DEFAULT_PASSKEY_KEY);
			return;
		}
	}
	clearWebAuthnCredential(storageKeyFor(credentialId));
	writeIndex(readIndex().filter((entry) => entry.credentialId !== credentialId));
}

/**
 * Before another passkey is created or restored — which takes the default's
 * place (passkey-identity.js) — keep the current default in the list, so it
 * can still unlock from this browser.
 */
export function keepDefaultAside() {
	const current = listStoredPasskeys().find((p) => p.isDefault);
	if (!current || readIndex().some((entry) => entry.credentialId === current.credentialId)) return;
	storeWebAuthnCredential(current.credential, storageKeyFor(current.credentialId));
	writeIndex([
		...readIndex(),
		{ credentialId: current.credentialId, label: current.label, addedAt: new Date().toISOString() }
	]);
}
