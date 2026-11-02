// Two passkeys of this site on one authenticator, as two in one keychain.
//
// keys.spec.js gives each key an authenticator of its own and lets only the
// touched one answer, so it never sees what happens when both could. A request
// for a PRF output that names no passkey is answered by either, and a second
// key's vault slot sealed with the first one's PRF output opens for the first
// one only. That is how simple-todo's invoice01 lost a slot under provider
// 0.12.0 (Le-Space/simple-todo#95).
//
// Here both live on one virtual authenticator, and every request is recorded:
// the passkeys it names, and the one that answered. The second test sends the
// request to the other passkey, as an authenticator that ignores the list
// would answer. Under provider 0.10.0 the first test passes too (the read was
// pinned, by accident: see passkey-identity.js), and the second fails: the
// other passkey's answer sealed the new key's slot.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';

/**
 * Record every WebAuthn request from the first script on: the passkeys the
 * page names, and the one that answered (for `create`, the one made). With
 * `sessionStorage['steer-prf-to']` set, a request for a PRF output is sent to
 * that passkey instead of the ones the page named.
 *
 * @param {import('@playwright/test').Page} page
 */
async function recordRequests(page) {
	await page.addInitScript(() => {
		/** @param {ArrayBuffer | ArrayBufferView} bytes */
		const encode = (bytes) => {
			const view = ArrayBuffer.isView(bytes)
				? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
				: new Uint8Array(bytes);
			return btoa(String.fromCharCode(...view))
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=+$/, '');
		};
		/** @param {string} id */
		const decode = (id) =>
			Uint8Array.from(atob(id.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
		/** @type {{ kind: string, prf: boolean, allow: string[], answered: string | null }[]} */
		const log = [];
		Object.defineProperty(window, '__passkeyRequests', { value: log });
		for (const kind of /** @type {const} */ (['create', 'get'])) {
			const original = navigator.credentials[kind].bind(navigator.credentials);
			navigator.credentials[kind] = async (/** @type {any} */ options) => {
				const prf = Boolean(options?.publicKey?.extensions?.prf);
				const allow = (options?.publicKey?.allowCredentials ?? []).map((/** @type {any} */ c) =>
					encode(c.id)
				);
				const entry = { kind, prf, allow, answered: /** @type {string | null} */ (null) };
				log.push(entry);
				const steer = sessionStorage.getItem('steer-prf-to');
				if (kind === 'get' && prf && steer) {
					options = {
						...options,
						publicKey: {
							...options.publicKey,
							allowCredentials: [{ type: 'public-key', id: decode(steer) }]
						}
					};
				}
				const result = /** @type {any} */ (await original(options));
				entry.answered = result ? encode(result.rawId) : null;
				return result;
			};
		}
	});
}

/** @param {import('@playwright/test').Page} page */
const requests = (page) =>
	page.evaluate(
		() =>
			/** @type {{ kind: string, prf: boolean, allow: string[], answered: string | null }[]} */ (
				/** @type {any} */ (window).__passkeyRequests.splice(0)
			)
	);

/** @param {import('@playwright/test').Page} page */
const secrets = (page) => page.evaluate(() => /** @type {any} */ (window).__invoiceE2E.secrets());

/** @param {import('@playwright/test').Page} page @param {string | null} id */
const steerTo = (page, id) =>
	page.evaluate((to) => {
		if (to) sessionStorage.setItem('steer-prf-to', to);
		else sessionStorage.removeItem('steer-prf-to');
	}, id);

/**
 * Books made with a first passkey, "Laptop". Every PRF request names it.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>} its credential id
 */
async function makeBooks(page) {
	await page.goto('/');
	await page.getByTestId('passkey-label').fill('Laptop');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	const made = await requests(page);
	const id = /** @type {string} */ (made.find((r) => r.kind === 'create')?.answered);
	const reads = made.filter((r) => r.kind === 'get' && r.prf);
	expect(reads.length).toBeGreaterThan(0);
	for (const read of reads) expect(read).toMatchObject({ allow: [id], answered: id });
	return id;
}

/** @param {import('@playwright/test').Page} page @param {string} label */
async function addPasskey(page, label) {
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	await page.getByTestId('key-label').fill(label);
	await page.getByTestId('key-add').click();
}

/** @param {import('@playwright/test').Page} page @param {string} label */
async function unlockWith(page, label) {
	await page.getByTestId('passkey-choice').selectOption({ label });
	await page.getByTestId('passkey-unlock').click();
}

test('every request for a PRF output names the passkey it asks, and that one answers', async ({
	page
}) => {
	test.setTimeout(180_000);
	await addVirtualAuthenticator(page);
	await recordRequests(page);
	const a = await makeBooks(page);
	const books = await secrets(page);

	// A second passkey, on the same authenticator as the first.
	await addPasskey(page, 'Zweiter Passkey');
	await expect(page.getByTestId('key-row')).toHaveCount(2);
	await expect(page.getByTestId('keys-error')).toHaveCount(0);
	const added = await requests(page);
	const b = /** @type {string} */ (added.find((r) => r.kind === 'create')?.answered);
	expect(b).not.toBe(a);
	// Its slot is sealed with its own PRF output: the request names it, and it answered.
	expect(added.filter((r) => r.kind === 'get')).toEqual([
		{ kind: 'get', prf: true, allow: [b], answered: b }
	]);

	// Locked, and opened with each of them: one request, for the chosen one, and the same books.
	for (const [label, id] of [
		['Zweiter Passkey', b],
		['Laptop', a]
	]) {
		await page.getByTestId('lock').click();
		await unlockWith(page, label);
		await expect(page.getByTestId('own-did')).toBeVisible();
		expect(await requests(page)).toEqual([{ kind: 'get', prf: true, allow: [id], answered: id }]);
		const opened = await secrets(page);
		expect(opened.databaseKey).toBe(books.databaseKey);
		expect(opened.booksSecret).toBe(books.booksSecret);
		expect(opened.ucepSeed).toBe(books.ucepSeed);
	}
});

test('another passkey’s answer opens nothing and seals nothing', async ({ page }) => {
	test.setTimeout(180_000);
	await addVirtualAuthenticator(page);
	await recordRequests(page);
	const a = await makeBooks(page);
	const books = await secrets(page);

	// A second passkey is made, and the request for its PRF output is answered by the first.
	await steerTo(page, a);
	await addPasskey(page, 'Zweiter Passkey');
	await expect(page.getByTestId('keys-error')).toContainText('anderer Passkey');
	await expect(page.getByTestId('key-row')).toHaveCount(1);
	const refused = await requests(page);
	const b = /** @type {string} */ (refused.find((r) => r.kind === 'create')?.answered);
	expect(refused.filter((r) => r.kind === 'get')).toEqual([
		{ kind: 'get', prf: true, allow: [b], answered: a }
	]);

	// Answered by the passkey it asks, the same step goes through (with a new passkey).
	await steerTo(page, null);
	await addPasskey(page, 'Zweiter Passkey');
	await expect(page.getByTestId('key-row')).toHaveCount(2);
	const c = /** @type {string} */ (
		(await requests(page)).find((r) => r.kind === 'create')?.answered
	);

	// Unlocking with it, answered by the first: nothing opens.
	await page.getByTestId('lock').click();
	await steerTo(page, a);
	await unlockWith(page, 'Zweiter Passkey');
	await expect(page.getByTestId('passkey-error')).toContainText('anderer Passkey');
	await expect(page.getByTestId('own-did')).toHaveCount(0);
	expect(await requests(page)).toEqual([{ kind: 'get', prf: true, allow: [c], answered: a }]);

	// Answered by the passkey it asks, the books open: the same ones.
	await steerTo(page, null);
	await unlockWith(page, 'Zweiter Passkey');
	await expect(page.getByTestId('own-did')).toBeVisible();
	expect(await requests(page)).toEqual([{ kind: 'get', prf: true, allow: [c], answered: c }]);
	expect((await secrets(page)).databaseKey).toBe(books.databaseKey);
});
