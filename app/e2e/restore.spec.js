// "Bücher aus einer Sicherung holen" (Le-Space/invoice#28): the acceptance of
// the two-keys plan's phase 3, in a browser. Books made with key A and a backup
// kept on (a fake) Aleph; key B added, which that backup does not know, so the
// page says so until a second backup; then the browser forgets everything, and
// key B alone — with nothing but the paying account's address — brings the
// books back from the backup it opens: what A wrote, the same books identity,
// and B writes on.
//
// Two virtual authenticators on one page, as in keys.spec.js: the device's own
// passkey (A) and a security key on USB (B), each with its own PRF secret; only
// the key being "touched" answers. Every key, address and amount is made up.
import { test, expect } from '@playwright/test';

import { toChecksumAddress } from '../src/lib/aleph-signer.js';
import { startFakeAleph } from './fake-aleph.js';
import { forgetThisDevice, recordCeremonies, takeCeremonies } from './webauthn.js';

const OWNER = toChecksumAddress(`0x${'7a'.repeat(20)}`);
const KEY = {
	protocol: 'ctap2',
	ctap2Version: 'ctap2_1',
	transport: 'internal',
	hasResidentKey: true,
	hasUserVerification: true,
	isUserVerified: true,
	hasLargeBlob: true,
	hasPrf: true,
	automaticPresenceSimulation: true
};

/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let aleph;

test.beforeAll(async () => {
	aleph = await startFakeAleph();
});
test.afterAll(async () => {
	await aleph?.close();
});

/** @param {import('@playwright/test').Page} page @param {string} customer */
async function issue(page, customer) {
	await page.getByRole('link', { name: 'Rechnungen', exact: true }).click();
	await page.getByTestId('new-template').selectOption('usdc-base');
	await page.getByTestId('new-invoice').click();
	await expect(page.getByTestId('draft-editor')).toBeVisible();
	await page.getByTestId('customer-name').fill(customer);
	await page.getByTestId('customer-address').fill('Beispielweg 2\n54321 Beispielstadt');
	await page.getByTestId('line-description').fill('Serverbetrieb');
	await page.getByTestId('line-price').fill('12,5');
	const delivery = await page.getByTestId('delivery-date').inputValue();
	await page.getByTestId('rate-per-unit').fill('0,9123');
	await page.getByTestId('rate-source').fill('CoinGecko');
	await page.getByTestId('rate-date').fill(delivery);
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByTestId('issue').click();
	await expect(page.getByTestId('issued-invoice')).toBeVisible();
	const heading = /** @type {string} */ (await page.getByRole('heading').first().textContent());
	return /** @type {string} */ (heading.match(/\d{4}-\d{5}-\d{3}/)?.[0]);
}

/** @param {import('@playwright/test').Page} page */
async function invoiceNumbers(page) {
	await page.getByRole('link', { name: 'Rechnungen', exact: true }).click();
	await expect(page.getByTestId('invoice-row').first()).toBeVisible();
	const rows = await page.getByTestId('invoice-row').allTextContents();
	return rows.map((row) => row.match(/\d{4}-\d{5}-\d{3}/)?.[0]).sort();
}

test('key B alone brings the books back from a backup on an empty device, and writes on', async ({
	page
}) => {
	test.setTimeout(300_000);
	await page.addInitScript((url) => localStorage.setItem('invoice.e2e.alephUrl', url), aleph.url);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId: keyA } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: KEY
	});
	/** @param {string} authenticatorId @param {boolean} enabled */
	const presence = (authenticatorId, enabled) =>
		cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled });
	await recordCeremonies(page);

	// Books made with key A, with an invoice in them.
	await page.goto('/');
	await page.getByTestId('passkey-label').fill('Laptop');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	await page.getByTestId('issuer-name').fill('Wolkenfabrik Hosting UG');
	await page.getByTestId('issuer-address').fill('Musterstraße 1\n12345 Musterstadt');
	await page.getByTestId('crypto-eth').fill('0x0000000000000000000000000000000000000001');
	await page.getByTestId('save-settings').click();
	await expect(page.getByRole('status').first()).toContainText('Gespeichert');
	const first = await issue(page, 'Erster Kunde AG');
	const booksDid = await page.evaluate(() => /** @type {any} */ (window).__invoiceE2E.booksDid());

	// A backup while A is the only key, kept for the paying account (grant and
	// credits done in the fake).
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	const section = page.getByTestId('backup');
	await expect(section.getByTestId('backup-address')).toHaveText(/0x[0-9a-fA-F]{40}/);
	const address = /** @type {string} */ (
		await section.getByTestId('backup-address').textContent()
	).trim();
	aleph.grant(OWNER, { address, types: ['STORE'], channels: ['INVOICE-BACKUP'], chain: 'ETH' });
	aleph.fund(OWNER, 1_000_000);
	await section.getByTestId('backup-owner').fill(OWNER);
	await section.getByTestId('backup-owner-save').click();
	await expect(section.getByTestId('backup-granted')).toBeVisible();
	await section.getByTestId('backup-now').click();
	await expect(section.getByTestId('backup-made')).toContainText('von Aleph aufbewahrt', {
		timeout: 60_000
	});
	await expect(section.getByTestId('backup-opens')).toHaveText('Öffnet mit „Laptop“');
	await expect(section.getByTestId('backup-uncovered')).toHaveCount(0);

	// Key B added; from now on only B answers. The backup there is does not
	// know B, and the page says so.
	const { authenticatorId: keyB } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: { ...KEY, transport: 'usb' }
	});
	await presence(keyA, false);
	await page.getByTestId('key-label').fill('YubiKey Schublade');
	await page.getByTestId('key-add').click();
	await expect(page.getByTestId('key-row')).toHaveCount(2);
	await expect(section.getByTestId('backup-uncovered')).toContainText(
		'kennt den Schlüssel „YubiKey Schublade“ noch nicht'
	);

	// A second backup: every key opens it.
	await section.getByTestId('backup-now').click();
	await expect(section.getByTestId('backup-row')).toHaveCount(2, { timeout: 60_000 });
	await expect(section.getByTestId('backup-uncovered')).toHaveCount(0);
	await expect(section.getByTestId('backup-opens')).toHaveText([
		'Öffnet mit „Laptop“, „YubiKey Schublade“',
		'Öffnet mit „Laptop“'
	]);

	// The device forgets everything: no passkey, no vault, no books. Key A is
	// gone with the old device; key B is the one at hand.
	await presence(keyB, true);
	await forgetThisDevice(page);
	await page.goto('/');
	await expect(page.getByTestId('passkey-onboarding')).toBeVisible();
	await expect(page.getByTestId('passkey-unlock')).toHaveCount(0);
	await takeCeremonies(page);

	// "Passkey wiederherstellen" would start empty books here: it asks first.
	// Declined, nothing is made, and the passkey is not kept.
	/** @type {string[]} */ const asked = [];
	page.once('dialog', (dialog) => {
		asked.push(dialog.message());
		void dialog.dismiss();
	});
	await page.getByTestId('passkey-restore').click();
	await expect(page.getByTestId('passkey-error')).toContainText('keine neuen Bücher angelegt');
	expect(asked[0]).toContain('Bücher aus einer Sicherung holen');
	await expect(page.getByTestId('passkey-unlock')).toHaveCount(0);
	await takeCeremonies(page);

	// Key B and the account's address: the books come back.
	await page.getByTestId('restore-owner').fill(OWNER);
	await page.getByTestId('restore-start').click();
	await expect(page.getByTestId('own-did')).toBeVisible({ timeout: 90_000 });
	await expect(page.getByTestId('restore-done')).toContainText('Aus der Sicherung vom');
	// The passkey from its authenticator, then the one PRF answer that unlocks.
	expect((await takeCeremonies(page)).map((c) => c.kind)).toEqual(['get', 'get', 'get']);

	// The same books: A's invoice, the same identity, and both keys still in the vault.
	expect(await invoiceNumbers(page)).toEqual([first]);
	expect(await page.evaluate(() => /** @type {any} */ (window).__invoiceE2E.booksDid())).toBe(
		booksDid
	);
	// It came back from the second backup, the newest that B opens: both
	// backups are in the list, and no key is left out of the newest.
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	await expect(page.getByTestId('key-row')).toHaveCount(2);
	await expect(section.getByTestId('backup-row')).toHaveCount(2);
	await expect(section.getByTestId('backup-uncovered')).toHaveCount(0);

	// B writes on, in a number circle of its own.
	const second = await issue(page, 'Zweiter Kunde GmbH');
	expect(second.split('-')[1]).not.toBe(first.split('-')[1]);
	expect(await invoiceNumbers(page)).toEqual([first, second].sort());
});

test('a passkey added after the last backup brings nothing back, and nothing is kept', async ({
	page
}) => {
	test.setTimeout(300_000);
	const owner = toChecksumAddress(`0x${'7b'.repeat(20)}`);
	await page.addInitScript((url) => localStorage.setItem('invoice.e2e.alephUrl', url), aleph.url);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId: keyA } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: KEY
	});
	/** @param {string} authenticatorId @param {boolean} enabled */
	const presence = (authenticatorId, enabled) =>
		cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled });

	// Books made with key A, and a backup while A is the only key.
	await page.goto('/');
	await page.getByTestId('passkey-label').fill('Laptop');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	const section = page.getByTestId('backup');
	await expect(section.getByTestId('backup-address')).toHaveText(/0x[0-9a-fA-F]{40}/);
	const address = /** @type {string} */ (
		await section.getByTestId('backup-address').textContent()
	).trim();
	aleph.grant(owner, { address, types: ['STORE'], channels: ['INVOICE-BACKUP'], chain: 'ETH' });
	aleph.fund(owner, 1_000_000);
	await section.getByTestId('backup-owner').fill(owner);
	await section.getByTestId('backup-owner-save').click();
	await expect(section.getByTestId('backup-granted')).toBeVisible();
	await section.getByTestId('backup-now').click();
	await expect(section.getByTestId('backup-made')).toContainText('von Aleph aufbewahrt', {
		timeout: 60_000
	});

	// Key B added, and no backup since.
	const { authenticatorId: keyB } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: { ...KEY, transport: 'usb' }
	});
	await presence(keyA, false);
	await page.getByTestId('key-label').fill('YubiKey Schublade');
	await page.getByTestId('key-add').click();
	await expect(page.getByTestId('key-row')).toHaveCount(2);
	await expect(section.getByTestId('backup-uncovered')).toBeVisible();

	// The device forgets everything; B alone opens none of the account's backups.
	await forgetThisDevice(page);
	await page.goto('/');
	await page.getByTestId('restore-owner').fill(owner);
	await page.getByTestId('restore-start').click();
	await expect(page.getByTestId('passkey-error')).toContainText(
		'Eine Sicherung öffnen nur die Passkeys, die beim Sichern eingetragen waren'
	);
	// B is not kept: "Entsperren" would start empty books with it.
	await expect(page.getByTestId('passkey-unlock')).toHaveCount(0);
	await page.reload();
	await expect(page.getByTestId('passkey-onboarding')).toBeVisible();
	await expect(page.getByTestId('passkey-unlock')).toHaveCount(0);

	// A, which the backup knows, brings the books back, without B: B's slot was
	// never in a backup.
	await presence(keyB, false);
	await presence(keyA, true);
	await page.getByTestId('restore-owner').fill(owner);
	await page.getByTestId('restore-start').click();
	await expect(page.getByTestId('own-did')).toBeVisible({ timeout: 90_000 });
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	await expect(page.getByTestId('key-row')).toHaveCount(1);
});

test('removing a key renews the backup keys: the removed key opens no newer backup', async ({
	page
}) => {
	test.setTimeout(300_000);
	const owner = toChecksumAddress(`0x${'7c'.repeat(20)}`);
	await page.addInitScript((url) => localStorage.setItem('invoice.e2e.alephUrl', url), aleph.url);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId: keyA } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: KEY
	});
	/** @param {string} authenticatorId @param {boolean} enabled */
	const presence = (authenticatorId, enabled) =>
		cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled });
	/** Only these keys answer. @param {string[]} on @param {string[]} off */
	const only = async (on, off) => {
		for (const id of off) await presence(id, false);
		for (const id of on) await presence(id, true);
	};
	await recordCeremonies(page);

	// Books made with key A, a first backup for the paying account.
	await page.goto('/');
	await page.getByTestId('passkey-label').fill('Laptop');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	await page.getByTestId('issuer-name').fill('Wolkenfabrik Hosting UG');
	await page.getByTestId('issuer-address').fill('Musterstraße 1\n12345 Musterstadt');
	await page.getByTestId('crypto-eth').fill('0x0000000000000000000000000000000000000001');
	await page.getByTestId('save-settings').click();
	await expect(page.getByRole('status').first()).toContainText('Gespeichert');
	const first = await issue(page, 'Erster Kunde AG');
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	const section = page.getByTestId('backup');
	await expect(section.getByTestId('backup-address')).toHaveText(/0x[0-9a-fA-F]{40}/);
	const before = /** @type {string} */ (
		await section.getByTestId('backup-address').textContent()
	).trim();
	aleph.grant(owner, {
		address: before,
		types: ['STORE'],
		channels: ['INVOICE-BACKUP'],
		chain: 'ETH'
	});
	aleph.fund(owner, 1_000_000);
	await section.getByTestId('backup-owner').fill(owner);
	await section.getByTestId('backup-owner-save').click();
	await expect(section.getByTestId('backup-granted')).toBeVisible();

	// Keys B and C, each on its own USB key.
	const { authenticatorId: keyB } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: { ...KEY, transport: 'usb' }
	});
	await only([keyB], [keyA]);
	await page.getByTestId('key-label').fill('YubiKey Schublade');
	await page.getByTestId('key-add').click();
	await expect(page.getByTestId('key-row')).toHaveCount(2);
	const { authenticatorId: keyC } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: { ...KEY, transport: 'usb' }
	});
	await only([keyC], [keyA, keyB]);
	await page.getByTestId('key-label').fill('YubiKey Tasche');
	await page.getByTestId('key-add').click();
	await expect(page.getByTestId('key-row')).toHaveCount(3);

	// A backup all three keys open.
	await section.getByTestId('backup-now').click();
	await expect(section.getByTestId('backup-row')).toHaveCount(1, { timeout: 60_000 });
	await expect(section.getByTestId('backup-opens')).toContainText('„YubiKey Tasche“');

	// C is lost. Removed with A, which unlocked the books; B, which stays, is asked once.
	await only([keyB], [keyA, keyC]);
	await takeCeremonies(page);
	await page
		.getByTestId('key-row')
		.filter({ hasText: 'YubiKey Tasche' })
		.getByTestId('key-remove')
		.click();
	await expect(page.getByTestId('key-row')).toHaveCount(2);
	await expect(page.getByTestId('keys-error')).toHaveCount(0);
	expect((await takeCeremonies(page)).map((c) => [c.kind, c.prf])).toEqual([['get', true]]);

	// A new Aleph key: not allowed yet, and the old one's grant to be taken back.
	await expect(section.getByTestId('backup-address')).not.toHaveText(before);
	const after = /** @type {string} */ (
		await section.getByTestId('backup-address').textContent()
	).trim();
	await expect(section.getByTestId('backup-not-granted')).toBeVisible();
	await expect(section.getByTestId('backup-revoke-command')).toHaveText(
		`pnpm setup:aleph -- --revoke ${before}`
	);
	// What belege's `--authorize` and `--revoke` do, done in the fake.
	aleph.grant(owner, {
		address: after,
		types: ['STORE'],
		channels: ['INVOICE-BACKUP'],
		chain: 'ETH'
	});
	aleph.revoke(owner, before);
	await section.getByTestId('backup-check').click();
	await expect(section.getByTestId('backup-granted')).toBeVisible();
	await expect(section.getByTestId('backup-retired')).toHaveCount(0);

	// A backup under the new keys: C has no slot in front of it.
	await section.getByTestId('backup-now').click();
	await expect(section.getByTestId('backup-row')).toHaveCount(2, { timeout: 60_000 });
	await expect(section.getByTestId('backup-opens').first()).toHaveText(
		'Öffnet mit „Laptop“, „YubiKey Schublade“'
	);
	expect(aleph.stores.at(-1)).toMatchObject({ sender: after, owner, status: 'processed' });

	// On an empty device, C finds only the backup from before it was removed,
	// with the old Aleph key, which the account no longer allows.
	await forgetThisDevice(page);
	await only([keyC], [keyA, keyB]);
	await page.goto('/');
	await page.getByTestId('restore-owner').fill(owner);
	await page.getByTestId('restore-start').click();
	await expect(page.getByTestId('own-did')).toBeVisible({ timeout: 90_000 });
	expect(await invoiceNumbers(page)).toEqual([first]);
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	await expect(page.getByTestId('key-row')).toHaveCount(3);
	await expect(section.getByTestId('backup-address')).toHaveText(before);
	await expect(section.getByTestId('backup-not-granted')).toBeVisible();

	// B, which stays, gets the newest backup, under the new keys.
	await forgetThisDevice(page);
	await only([keyB], [keyA, keyC]);
	await page.goto('/');
	await page.getByTestId('restore-owner').fill(owner);
	await page.getByTestId('restore-start').click();
	await expect(page.getByTestId('own-did')).toBeVisible({ timeout: 90_000 });
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	await expect(page.getByTestId('key-row')).toHaveCount(2);
	await expect(section.getByTestId('backup-address')).toHaveText(after);
	await expect(section.getByTestId('backup-granted')).toBeVisible();
	await expect(section.getByTestId('backup-row')).toHaveCount(2);
});
