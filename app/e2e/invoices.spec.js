// The invoice app end to end: a passkey opens sealed books, an issuer with an
// Ethereum address, an invoice from the USDC-on-Base template, issued and
// printed, still there after a reload — and nothing of it readable on disk.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator, recordCeremonies, takeCeremonies } from './webauthn.js';
import { everythingStoredAsText, spellings } from './storage-scan.js';

// Made-up data; the EVM address is made of zero bytes but the last.
const ETH = '0x0000000000000000000000000000000000000001';

test('a USDC invoice from a template, issued, printed and sealed', async ({ page }) => {
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

	// The issuer, and an address that is not an EVM address is flagged.
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	await page.getByTestId('issuer-name').fill('Wolkenfabrik Hosting UG');
	await page.getByTestId('issuer-address').fill('Musterstraße 1\n12345 Musterstadt');
	await page.getByTestId('crypto-eth').fill('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
	await expect(page.getByTestId('crypto-eth-invalid')).toBeVisible();
	await page.getByTestId('crypto-eth').fill(ETH);
	await expect(page.getByTestId('crypto-eth-invalid')).toHaveCount(0);
	// Only Bitcoin and Ethereum addresses are published.
	await expect(page.getByTestId('crypto-nym')).toHaveCount(0);
	await expect(page.getByTestId('crypto-akt')).toHaveCount(0);
	await expect(page.getByTestId('series')).toContainText('{YYYY}');
	await page.getByTestId('save-settings').click();
	await expect(page.getByRole('status')).toContainText('Gespeichert');

	// A draft from the USDC template: currency and network.
	await page.getByRole('link', { name: 'Rechnungen', exact: true }).click();
	await expect(page.getByTestId('new-template').locator('option[value="nym-node"]')).toHaveCount(0);
	await page.getByTestId('new-template').selectOption('usdc-base');
	await page.getByTestId('new-invoice').click();
	await expect(page.getByTestId('draft-editor')).toBeVisible();
	await expect(page.getByTestId('currency')).toHaveValue('USDC');
	await expect(page.getByTestId('network')).toHaveValue('base');
	await expect(page.getByTestId('currency').locator('option[value="NYM"]')).toHaveCount(0);

	// Not ready yet: the customer is missing, and the euro rate for the VAT.
	await expect(page.getByTestId('problems')).toBeVisible();
	await expect(page.getByTestId('issue')).toBeDisabled();

	await page.getByTestId('customer-name').fill(customer);
	await page.getByTestId('customer-address').fill('Beispielweg 2\n54321 Beispielstadt');
	await page.getByTestId('line-description').fill('Serverbetrieb');
	await page.getByTestId('line-price').fill('12,5');
	const delivery = await page.getByTestId('delivery-date').inputValue();
	await page.getByTestId('rate-per-unit').fill('0,9123');
	await page.getByTestId('rate-source').fill('CoinGecko');
	await page.getByTestId('rate-date').fill(delivery);
	await expect(page.getByTestId('problems')).toHaveCount(0);
	// 12.5 USDC + 19 % = 14.875 USDC
	await expect(page.getByTestId('draft-due')).toContainText('14,875 USDC');

	page.once('dialog', (dialog) => dialog.accept());
	await page.getByTestId('issue').click();
	await expect(page.getByTestId('issued-invoice')).toBeVisible();
	await expect(page.getByRole('heading')).toContainText(/Rechnung \d{4}-\d{5}-001/);
	await expect(page.getByTestId('issued-due')).toContainText('14,875 USDC');

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
	expect(text).not.toContain('Serverbetrieb');
	for (const key of [secrets.signingKey, secrets.databaseKey, secrets.ucepSeed]) {
		for (const form of spellings(key)) expect(text).not.toContain(form);
	}

	// The key, the names and the UCEP seed are in the books' vault now: one
	// record, one slot, the passkey's — sealed, which the scan above shows.
	const vaults = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('invoice.vaults.v1') ?? 'null')
	);
	expect(vaults).toHaveLength(1);
	expect(vaults[0].slots).toHaveLength(1);
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
