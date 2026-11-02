// The PRF read: it asks the passkey it names, with the input every earlier
// read used, and turns another passkey's answer away.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OtherPasskeyError, PrfUnavailableError, readPrfOutput } from './passkey-identity.js';
import { prfInputForRelyingParty } from '@le-space/orbitdb-identity-provider-webauthn-did';

const ASKED = new Uint8Array(16).fill(1);
const OTHER = new Uint8Array(16).fill(2);
const OUTPUT = new Uint8Array(32).fill(9);

/**
 * A browser whose authenticator answers every request as `answeredBy`, and
 * the requests it was given.
 *
 * @param {{ answeredBy?: Uint8Array, output?: Uint8Array | null, refuse?: Error }} [options]
 */
function authenticator({ answeredBy = ASKED, output = OUTPUT, refuse } = {}) {
	/** @type {any[]} */
	const requests = [];
	vi.stubGlobal('location', { hostname: 'localhost' });
	vi.stubGlobal('navigator', {
		credentials: {
			get: async (/** @type {any} */ options) => {
				requests.push(options);
				if (refuse) throw refuse;
				return {
					rawId: answeredBy.slice().buffer,
					getClientExtensionResults: () =>
						output ? { prf: { results: { first: output.slice().buffer } } } : {}
				};
			}
		}
	});
	return requests;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('readPrfOutput', () => {
	it('names the passkey it asks, with the PRF input it was registered with', async () => {
		const requests = authenticator();
		const prfInput = new Uint8Array(32).fill(7);

		expect(await readPrfOutput({ rawCredentialId: ASKED, prfInput })).toEqual(OUTPUT);
		expect(requests).toHaveLength(1);
		const { allowCredentials, extensions, userVerification } = requests[0].publicKey;
		expect(allowCredentials.map((/** @type {any} */ c) => new Uint8Array(c.id))).toEqual([ASKED]);
		expect(new Uint8Array(extensions.prf.eval.first)).toEqual(prfInput);
		expect(userVerification).toBe('required');
	});

	it('asks a passkey without its own input the fixed question for this site, as before', async () => {
		// The books' vault slot is sealed with this answer: another input would
		// give another key, and books made before 0.12.2 would not open.
		const requests = authenticator();

		await readPrfOutput({ rawCredentialId: ASKED });
		expect(new Uint8Array(requests[0].publicKey.extensions.prf.eval.first)).toEqual(
			await prfInputForRelyingParty('localhost')
		);
	});

	it('turns away another passkey’s answer', async () => {
		authenticator({ answeredBy: OTHER });

		const read = readPrfOutput({ rawCredentialId: ASKED });
		await expect(read).rejects.toBeInstanceOf(OtherPasskeyError);
		await expect(read).rejects.toThrow('anderer Passkey');
	});

	it('says so in German when the authenticator has no PRF', async () => {
		authenticator({ output: null });

		const read = readPrfOutput({ rawCredentialId: ASKED });
		await expect(read).rejects.toBeInstanceOf(PrfUnavailableError);
		await expect(read).rejects.toThrow('kein PRF-Geheimnis');
	});

	it('leaves a refused prompt a refusal', async () => {
		const refusal = new Error('The operation either timed out or was not allowed.');
		refusal.name = 'NotAllowedError';
		authenticator({ refuse: refusal });

		await expect(readPrfOutput({ rawCredentialId: ASKED })).rejects.toBe(refusal);
	});
});
