// The invoice app end to end: a passkey opens sealed books, an issuer with a
// NYM address, an invoice from the NYM template, issued and printed, still
// there after a reload — and nothing of it readable on disk.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator, recordCeremonies, takeCeremonies } from './webauthn.js';
import { everythingStoredAsText, spellings } from './storage-scan.js';

// Made-up data; the NYM address is made of zero bytes.
const NYM = 'n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp8hacc';

test('a NYM invoice from a template, issued, printed and sealed', async ({ page }) => {
	const customer = `Stromwerk Test AG ${Date.now().toString(36)}`;
	await addVirtualAuthenticator(page);
	await recordCeremonies(page);

	await page.goto('/');
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	const didBadge = page.getByTestId('own-did');
	await expect(didBadge).toBeVisible();
	const did = await didBadge.getAttribute('data-did');
	expect(did).toMatch(/^did:key:/);
	expect((await takeCeremonies(page)).map((c) => [c.kind, c.prf])).toEqual([
		['create', true],
		['get', true],
		['get', false]
	]);
	await expect(page.getByTestId('empty')).toBeVisible();

	// The issuer, and an address that is not a NYM address is flagged.
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	await page.getByTestId('issuer-name').fill('Wolkenfabrik Hosting UG');
	await page.getByTestId('issuer-address').fill('Musterstraße 1\n12345 Musterstadt');
	await page.getByTestId('crypto-nym').fill('akash1qyqszqgpqyqszqgpqyqszqgpqyqszqgplgve5x');
	await expect(page.getByTestId('crypto-nym-invalid')).toBeVisible();
	await page.getByTestId('crypto-nym').fill(NYM);
	await expect(page.getByTestId('crypto-nym-invalid')).toHaveCount(0);
	await expect(page.getByTestId('series')).toContainText('{YYYY}');
	await page.getByTestId('save-settings').click();
	await expect(page.getByRole('status')).toContainText('Gespeichert');

	// A draft from the NYM template: currency, network and the usual line.
	await page.getByRole('link', { name: 'Rechnungen', exact: true }).click();
	await page.getByTestId('new-template').selectOption('nym-node');
	await page.getByTestId('new-invoice').click();
	await expect(page.getByTestId('draft-editor')).toBeVisible();
	await expect(page.getByTestId('currency')).toHaveValue('NYM');
	await expect(page.getByTestId('network')).toHaveValue('nyx');
	await expect(page.getByTestId('line-description')).toHaveValue('Betrieb eines Nym-Knotens');

	// Not ready yet: the customer is missing, and the euro rate for the VAT.
	await expect(page.getByTestId('problems')).toBeVisible();
	await expect(page.getByTestId('issue')).toBeDisabled();

	await page.getByTestId('customer-name').fill(customer);
	await page.getByTestId('customer-address').fill('Beispielweg 2\n54321 Beispielstadt');
	await page.getByTestId('line-price').fill('12,5');
	const delivery = await page.getByTestId('delivery-date').inputValue();
	await page.getByTestId('rate-per-unit').fill('0,0612');
	await page.getByTestId('rate-source').fill('CoinGecko');
	await page.getByTestId('rate-date').fill(delivery);
	await expect(page.getByTestId('problems')).toHaveCount(0);
	// 12.5 NYM + 19 % = 14.875 NYM
	await expect(page.getByTestId('draft-due')).toContainText('14,875 NYM');

	page.once('dialog', (dialog) => dialog.accept());
	await page.getByTestId('issue').click();
	await expect(page.getByTestId('issued-invoice')).toBeVisible();
	await expect(page.getByRole('heading')).toContainText(/Rechnung \d{4}-\d{5}-001/);
	await expect(page.getByTestId('issued-due')).toContainText('14,875 NYM');

	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('download-pdf').click()
	]);
	expect(download.suggestedFilename()).toMatch(/^Rechnung-\d{4}-\d{5}-001\.pdf$/);
	const path = await download.path();
	const { readFile } = await import('node:fs/promises');
	expect((await readFile(path)).subarray(0, 5).toString()).toBe('%PDF-');

	// A reload: the stored passkey opens the same books, one prompt.
	await page.reload();
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(didBadge).toHaveAttribute('data-did', /** @type {string} */ (did));
	await page.getByRole('link', { name: 'Rechnungen', exact: true }).click();
	await expect(page.getByTestId('invoice-row').filter({ hasText: customer })).toBeVisible();

	// Sealed: neither the customer nor the keys are anywhere on disk as they are.
	const secrets = await page.evaluate(() => /** @type {any} */ (window).__invoiceE2E.secrets());
	const { text } = await everythingStoredAsText(page);
	expect(text).not.toContain(customer);
	expect(text).not.toContain('Mixnode');
	for (const key of [secrets.signingKey, secrets.databaseKey]) {
		for (const form of spellings(key)) expect(text).not.toContain(form);
	}
});

test('without PRF the books stay shut, with a clear message', async ({ page }) => {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			ctap2Version: 'ctap2_1',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			hasPrf: false,
			automaticPresenceSimulation: true
		}
	});

	await page.goto('/');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('passkey-error')).toContainText('kein PRF-Geheimnis');
	await expect(page.getByTestId('own-did')).toHaveCount(0);
	const { inventory } = await everythingStoredAsText(page);
	expect(inventory.filter((db) => db.database.includes('invoice/'))).toEqual([]);
});
