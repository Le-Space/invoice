// Two security keys, one set of books.
//
// Two virtual authenticators on one page, as two keys at one computer: the
// device's own passkey (A) and a security key on USB (B) — Chrome allows one
// internal authenticator per page, and a YubiKey is a USB key anyway. Each has
// its own PRF secret. Only the key being "touched" answers: the other has
// presence simulation off, so a request it could serve waits until the touched
// one has answered.
//
// The owner's acceptance for step 3: books made with key A; key B added; the
// books opened with B, which reads what A wrote and writes itself; A removed;
// B still opens everything, and A — even restored from its authenticator —
// opens nothing here, not even books of its own.
import { test, expect } from '@playwright/test';
import { recordCeremonies, takeCeremonies } from './webauthn.js';

const ETH = '0x0000000000000000000000000000000000000001';
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

/** @param {import('@playwright/test').Page} page */
const secrets = (page) => page.evaluate(() => /** @type {any} */ (window).__invoiceE2E.secrets());

test('a second key opens and writes the books, and the first can go', async ({ page }) => {
	test.setTimeout(240_000);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId: keyA } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: KEY
	});
	/** @param {string} authenticatorId @param {boolean} enabled */
	const presence = (authenticatorId, enabled) =>
		cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled });
	await recordCeremonies(page);

	// Books made with key A.
	await page.goto('/');
	await page.getByTestId('passkey-label').fill('Laptop');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	const didBadge = page.getByTestId('own-did');
	await expect(didBadge).toBeVisible();
	const didA = await didBadge.getAttribute('data-did');
	await expect(page.getByTestId('one-key-hint')).toBeVisible();
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	await page.getByTestId('issuer-name').fill('Wolkenfabrik Hosting UG');
	await page.getByTestId('issuer-address').fill('Musterstraße 1\n12345 Musterstadt');
	await page.getByTestId('crypto-eth').fill(ETH);
	await page.getByTestId('save-settings').click();
	await expect(page.getByRole('status')).toContainText('Gespeichert');
	const first = await issue(page, 'Erster Kunde AG');
	const books = await secrets(page);
	await takeCeremonies(page);

	// Key B, at the same computer. From now on only B answers.
	const { authenticatorId: keyB } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: { ...KEY, transport: 'usb' }
	});
	await presence(keyA, false);
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	await expect(page.getByTestId('key-row')).toHaveCount(1);
	await page.getByTestId('key-label').fill('YubiKey Schublade');
	await page.getByTestId('key-add').click();
	await expect(page.getByTestId('key-row')).toHaveCount(2);
	await expect(page.getByTestId('keys-error')).toHaveCount(0);
	// Two ceremonies, both on B: made, then the PRF answer its slot is sealed with.
	expect((await takeCeremonies(page)).map((c) => [c.kind, c.prf])).toEqual([
		['create', true],
		['get', true]
	]);
	await page.getByRole('link', { name: 'Rechnungen', exact: true }).click();
	await expect(page.getByTestId('one-key-hint')).toHaveCount(0);

	// Locked, and opened with B: one touch.
	await page.getByTestId('lock').click();
	await page.getByTestId('passkey-choice').selectOption({ label: 'YubiKey Schublade' });
	await page.getByTestId('passkey-unlock').click();
	await expect(didBadge).toBeVisible();
	const didB = await didBadge.getAttribute('data-did');
	expect(didB).not.toBe(didA);
	expect((await takeCeremonies(page)).map((c) => [c.kind, c.prf])).toEqual([['get', true]]);

	// The same books: what A wrote, the same key and peer seed, the same writer.
	expect(await invoiceNumbers(page)).toEqual([first]);
	const viaB = await secrets(page);
	expect(viaB.databaseKey).toBe(books.databaseKey);
	expect(viaB.ucepSeed).toBe(books.ucepSeed);
	expect(viaB.booksSecret).toBe(books.booksSecret);
	// And the keys a backup needs: B can make one, and open A's (Le-Space/invoice#28).
	expect(viaB.backupKey).toBe(books.backupKey);
	expect(viaB.alephKey).toBe(books.alephKey);
	expect(books.backupKey).not.toBe(books.databaseKey);

	// B writes, in a number circle of its own.
	const second = await issue(page, 'Zweiter Kunde GmbH');
	expect(second.split('-')[1]).not.toBe(first.split('-')[1]);

	// A goes. B stays, and is back to being the only one.
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	const rowA = page.getByTestId('key-row').filter({ hasText: 'Laptop' });
	await rowA.getByTestId('key-remove').click();
	await expect(page.getByTestId('key-row')).toHaveCount(1);
	await expect(page.getByTestId('key-row').first()).toContainText('YubiKey Schublade');
	await page.getByRole('link', { name: 'Rechnungen', exact: true }).click();
	await expect(page.getByTestId('one-key-hint')).toBeVisible();

	// Locked again: B is the only key this browser keeps, and it opens everything.
	await page.getByTestId('lock').click();
	await expect(page.getByTestId('passkey-choice')).toHaveCount(0);
	await page.getByTestId('passkey-unlock').click();
	await expect(didBadge).toHaveAttribute('data-did', /** @type {string} */ (didB));
	expect(await invoiceNumbers(page)).toEqual([first, second].sort());

	// A, restored from its authenticator, is turned away — no books of its own.
	await page.getByTestId('lock').click();
	await presence(keyB, false);
	await presence(keyA, true);
	await page.getByTestId('passkey-restore').click();
	await expect(page.getByTestId('passkey-error')).toContainText('entfernt');

	// B still opens the books.
	await presence(keyA, false);
	await presence(keyB, true);
	await page.reload();
	await page.getByTestId('passkey-choice').selectOption({ label: 'YubiKey Schublade' });
	await page.getByTestId('passkey-unlock').click();
	await expect(didBadge).toHaveAttribute('data-did', /** @type {string} */ (didB));
	expect(await invoiceNumbers(page)).toEqual([first, second].sort());
});
