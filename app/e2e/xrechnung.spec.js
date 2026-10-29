// An invoice that goes out as an XRechnung: the issuer's contact and address
// parts in the settings, the customer's in the draft, issuing refused until
// they are there, and the XML downloaded beside the PDF. KoSIT checks the
// format itself in CI (scripts/kosit.sh); this checks the way to it.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { addVirtualAuthenticator } from './webauthn.js';

test('an XRechnung: refused until the customer has what it needs, then downloaded', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('empty')).toBeVisible();

	// The issuer, made up; post code, city and country come from the address.
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	await page.getByTestId('issuer-name').fill('Wolkenfabrik Hosting GmbH');
	await page.getByTestId('issuer-address').fill('Musterstraße 1\n12345 Musterstadt');
	await page.getByTestId('issuer-postcode').focus();
	await expect(page.getByTestId('issuer-postcode')).toHaveValue('12345');
	await expect(page.getByTestId('issuer-city')).toHaveValue('Musterstadt');
	await expect(page.getByTestId('issuer-country')).toHaveValue('DE');
	await page.getByTestId('issuer-contact').fill('Erika Mustermann');
	await page.getByLabel('USt-IdNr.').fill('DE123456789');
	await page.getByLabel('E-Mail').fill('rechnung@example.com');
	await page.getByLabel('Telefon').fill('+49 30 1234567');
	await page.getByLabel('IBAN').fill('DE79 0000 0000 1234 5678 90');
	await page.getByTestId('save-settings').click();
	await expect(page.getByRole('status')).toContainText('Gespeichert');

	// A draft for a customer who gets an XRechnung.
	await page.getByRole('link', { name: 'Rechnungen', exact: true }).click();
	await page.getByTestId('new-invoice').click();
	await expect(page.getByTestId('draft-editor')).toBeVisible();
	await page.getByTestId('customer-name').fill('Beispiel Kunde GmbH');
	await page.getByTestId('customer-address').fill('Kundenweg 7\n54321 Beispielstadt');
	await page.getByTestId('line-description').fill('Beratung');
	await page.getByTestId('line-price').fill('950');
	await expect(page.getByTestId('problems')).toHaveCount(0);

	await page.getByTestId('e-invoice').selectOption('xrechnung');
	await expect(page.getByTestId('customer-postcode')).toHaveValue('54321');
	await expect(page.getByTestId('customer-city')).toHaveValue('Beispielstadt');
	await expect(page.getByTestId('customer-country')).toHaveValue('DE');
	// Refused until the buyer reference (BR-DE-15) and the e-mail address are there.
	const problems = page.getByTestId('problems');
	await expect(problems.locator('[data-code="invoice.problem.xr.buyerReference"]')).toBeVisible();
	await expect(problems.locator('[data-code="invoice.problem.xr.customerEmail"]')).toBeVisible();
	await expect(page.getByTestId('issue')).toBeDisabled();
	await page.getByTestId('customer-buyer-reference').fill('Bestellung 4711');
	await page.getByTestId('customer-email').fill('buchhaltung@example.org');
	// A post code the printed address does not name is refused too.
	await page.getByTestId('customer-postcode').fill('99999');
	await expect(
		problems.locator('[data-code="invoice.problem.xr.customerAddressMismatch"]')
	).toBeVisible();
	await page.getByTestId('customer-postcode').fill('54321');
	await expect(problems).toHaveCount(0);

	page.once('dialog', (dialog) => dialog.accept());
	await page.getByTestId('issue').click();
	await expect(page.getByTestId('issued-invoice')).toBeVisible();

	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('download-xml').click()
	]);
	expect(download.suggestedFilename()).toMatch(/^Rechnung-\d{4}-\d{5}-001\.xml$/);
	const xml = (await readFile(await download.path())).toString('utf8');
	expect(xml).toContain('urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0');
	expect(xml).toContain('<ram:BuyerReference>Bestellung 4711</ram:BuyerReference>');
	expect(xml).toContain('<ram:URIID schemeID="EM">buchhaltung@example.org</ram:URIID>');
	expect(xml).toContain('<ram:IBANID>DE79000000001234567890</ram:IBANID>');
	// 950,00 € + 19 % = 1.130,50 €
	expect(xml).toContain('<ram:DuePayableAmount>1130.50</ram:DuePayableAmount>');

	// The Storno keeps the customer's format; a customer who gets a PDF needs none of the fields.
	await page.getByTestId('cancel-invoice').click();
	await expect(page.getByTestId('draft-editor')).toBeVisible();
	await expect(page.getByTestId('e-invoice')).toHaveValue('xrechnung');
	await page.getByTestId('e-invoice').selectOption('pdf');
	await expect(page.getByTestId('customer-buyer-reference')).toHaveCount(0);
});
