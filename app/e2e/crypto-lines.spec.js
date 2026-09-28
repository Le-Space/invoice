// An invoice in euros with lines of crypto entered by hand: asset, quantity
// and rate typed in, the price computed, and a subtotal per asset above the
// subtotal of the invoice. Made-up data.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';

test('an invoice in euros with crypto lines, summed per asset', async ({ page }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await page.getByRole('link', { name: 'Einstellungen' }).click();
	await page.getByTestId('issuer-name').fill('Wolkenfabrik Hosting UG');
	await page.getByTestId('issuer-address').fill('Musterstraße 1\n12345 Musterstadt');
	// An own unit, and it for new lines; crypto lines keep Pauschale.
	await page.getByTestId('unit-new').fill('Lizenz');
	await page.getByTestId('unit-add').click();
	await expect(page.getByTestId('unit')).toContainText([
		'Stück',
		'Stunde',
		'Tag',
		'Monat',
		'Pauschale',
		'Lizenz'
	]);
	await page.getByTestId('default-unit').selectOption('Lizenz');
	await expect(page.getByTestId('crypto-unit')).toHaveValue('Pauschale');
	await page.getByTestId('save-settings').click();
	await expect(page.getByRole('status')).toContainText('Gespeichert');

	await page.getByRole('link', { name: 'Rechnungen', exact: true }).click();
	await page.getByTestId('new-invoice').click();
	await expect(page.getByTestId('draft-editor')).toBeVisible();
	await expect(page.getByTestId('currency')).toHaveValue('EUR');
	await page.getByTestId('customer-name').fill('Stromwerk Test AG');
	await page.getByTestId('customer-address').fill('Beispielweg 2\n54321 Beispielstadt');
	const delivery = await page.getByTestId('delivery-date').inputValue();

	// The first line counts in the unit chosen for new lines.
	await expect(page.getByTestId('line-unit').first()).toHaveValue('Lizenz');
	// The empty first line becomes an ordinary one.
	await page.getByTestId('line-description').first().fill('Einrichtung');
	await page.getByTestId('line-price').first().fill('50');

	// Two lines of NYM and one of AKT.
	const crypto = [
		{ description: 'Betrieb Knoten A', asset: 'NYM', quantity: '12,5', rate: '0,0612' },
		{ description: 'Betrieb Knoten B', asset: 'nym', quantity: '12,5', rate: '0,06' },
		{ description: 'Rechenkapazität', asset: 'AKT', quantity: '3', rate: '2,94' }
	];
	for (const [i, line] of crypto.entries()) {
		await page.getByTestId('add-crypto-line').click();
		const row = page.getByTestId('line').nth(i + 1);
		await row.getByTestId('line-description').fill(line.description);
		await row.getByTestId('crypto-asset').fill(line.asset);
		await row.getByTestId('crypto-quantity').fill(line.quantity);
		await row.getByTestId('crypto-rate').fill(line.rate);
		await row.getByTestId('crypto-rate-date').fill(delivery);
	}
	// Computed, not typed: 12.5 × 0.0612 € = 0.77 €.
	const first = page.getByTestId('line').nth(1);
	await expect(first.getByTestId('line-unit')).toHaveValue('Pauschale');
	await expect(first.getByTestId('line-price')).toHaveValue('0,77');
	await expect(first.getByTestId('crypto-subtitle')).toContainText('12,5 NYM zu 0,0612 € je NYM');

	// 0.77 + 0.75 = 1.52 € for 25 NYM; 3 × 2.94 = 8.82 € for 3 AKT.
	const sums = page.getByTestId('crypto-subtotal');
	await expect(sums).toHaveCount(2);
	await expect(sums.nth(0)).toContainText('davon 25 NYM');
	await expect(sums.nth(0)).toContainText('1,52');
	await expect(sums.nth(1)).toContainText('davon 3 AKT');
	await expect(sums.nth(1)).toContainText('8,82');
	// (50 + 1.52 + 8.82) × 1.19 = 71.80 €
	await expect(page.getByTestId('draft-due')).toContainText('71,80');

	// A crypto line without a rate is not a line yet.
	await first.getByTestId('crypto-rate').fill('');
	await expect(page.getByTestId('problems')).toContainText('Krypto-Position');
	await first.getByTestId('crypto-rate').fill('0,0612');
	await expect(page.getByTestId('problems')).toHaveCount(0);

	page.once('dialog', (dialog) => dialog.accept());
	await page.getByTestId('issue').click();
	await expect(page.getByTestId('issued-invoice')).toBeVisible();
	await expect(page.getByTestId('issued-due')).toContainText('71,80');
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('download-pdf').click()
	]);
	const { readFile } = await import('node:fs/promises');
	expect((await readFile(await download.path())).subarray(0, 5).toString()).toBe('%PDF-');
});
