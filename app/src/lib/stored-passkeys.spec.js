// The passkeys this browser keeps: the first where it always was, the others
// beside it, the last one used as the default.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	DEFAULT_PASSKEY_KEY,
	PASSKEYS_INDEX_KEY,
	forgetPasskey,
	listStoredPasskeys,
	makeDefaultPasskey,
	rememberPasskey
} from './stored-passkeys.js';
import { storeWebAuthnCredential } from '@le-space/orbitdb-identity-provider-webauthn-did';

/** A credential as the provider stores it; made up. */
function credential(/** @type {string} */ name, /** @type {number} */ seed) {
	const raw = new Uint8Array(16).fill(seed);
	return {
		credentialId: Buffer.from(raw).toString('base64url'),
		rawCredentialId: raw,
		attestationObject: new Uint8Array(0),
		publicKey: {
			algorithm: -7,
			keyType: 2,
			curve: 1,
			x: new Uint8Array(32).fill(seed),
			y: new Uint8Array(32).fill(seed + 1)
		},
		displayName: name
	};
}

beforeEach(() => {
	const items = new Map();
	/** @type {any} */ (globalThis).localStorage = {
		getItem: (/** @type {string} */ k) => (items.has(k) ? items.get(k) : null),
		setItem: (/** @type {string} */ k, /** @type {string} */ v) => void items.set(k, String(v)),
		removeItem: (/** @type {string} */ k) => void items.delete(k)
	};
});
afterEach(() => {
	delete (/** @type {any} */ (globalThis).localStorage);
});

describe('stored passkeys', () => {
	it('lists the first where it always was, and keeps a second beside it', () => {
		const a = credential('Laptop', 1);
		const b = credential('YubiKey', 2);
		storeWebAuthnCredential(a, DEFAULT_PASSKEY_KEY);
		rememberPasskey(b, 'YubiKey Schublade');

		const listed = listStoredPasskeys();
		expect(listed.map((p) => [p.label, p.isDefault])).toEqual([
			['Laptop', true],
			['YubiKey Schublade', false]
		]);
		expect(listed[1].credential.rawCredentialId).toEqual(b.rawCredentialId);
		// Remembering it again changes nothing.
		rememberPasskey(b, 'anders');
		expect(listStoredPasskeys()).toHaveLength(2);
	});

	it('makes the one that unlocked the default, and keeps the other with its label', () => {
		const a = credential('Laptop', 1);
		const b = credential('YubiKey', 2);
		storeWebAuthnCredential(a, DEFAULT_PASSKEY_KEY);
		rememberPasskey(b, 'YubiKey Schublade');

		makeDefaultPasskey(b.credentialId);
		expect(listStoredPasskeys().map((p) => [p.label, p.isDefault])).toEqual([
			['YubiKey', true],
			['Laptop', false]
		]);
		expect(
			JSON.parse(/** @type {string} */ (localStorage.getItem(DEFAULT_PASSKEY_KEY))).credentialId
		).toBe(b.credentialId);
	});

	it('forgets one; forgetting the default lets the next take its place', () => {
		const a = credential('Laptop', 1);
		const b = credential('YubiKey', 2);
		storeWebAuthnCredential(a, DEFAULT_PASSKEY_KEY);
		rememberPasskey(b, 'YubiKey Schublade');

		forgetPasskey(a.credentialId);
		const left = listStoredPasskeys();
		expect(left.map((p) => p.credentialId)).toEqual([b.credentialId]);
		expect(left[0].isDefault).toBe(true);
		expect(localStorage.getItem(PASSKEYS_INDEX_KEY)).toBeNull();

		forgetPasskey(b.credentialId);
		expect(listStoredPasskeys()).toEqual([]);
	});
});
