// "Jetzt sichern" (Le-Space/invoice#28): the backup file is built in the
// browser with the books' vault in front, uploaded from the browser to Aleph's
// IPFS host, and kept by a STORE the browser signs with the vault's Aleph key
// for the paying account — once that account has let the key do so, and only
// while it has the credits. Against a fake Aleph (fake-aleph.js); every key,
// address and amount is made up.
import { test, expect } from '@playwright/test';
import { readAppBackupHeader } from '@le-space/orbitdb-storage-bridge/app-backup';

import { toChecksumAddress } from '../src/lib/aleph-signer.js';
import { startFakeAleph } from './fake-aleph.js';
import { addVirtualAuthenticator } from './webauthn.js';

/** The paying account: made up. */
const OWNER = toChecksumAddress(`0x${'5e'.repeat(20)}`);
const ISSUER = 'Wolkenfabrik Hosting UG';
const CUSTOMER = 'Erster Kunde AG';

/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let aleph;

test.beforeAll(async () => {
	aleph = await startFakeAleph();
});
test.afterAll(async () => {
	await aleph?.close();
});

/** @param {import('@playwright/test').Page} page */
async function issueInvoice(page) {
	await page.getByRole('link', { name: 'Rechnungen', exact: true }).click();
	await page.getByTestId('new-template').selectOption('usdc-base');
	await page.getByTestId('new-invoice').click();
	await expect(page.getByTestId('draft-editor')).toBeVisible();
	await page.getByTestId('customer-name').fill(CUSTOMER);
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
}

test('"Jetzt sichern": built and uploaded in the browser, kept by a STORE it signs for the paying account', async ({
	page
}) => {
	test.setTimeout(240_000);
	await page.addInitScript((url) => localStorage.setItem('invoice.e2e.alephUrl', url), aleph.url);
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await page.getByTestId('passkey-label').fill('Laptop');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	// Books with something in them.
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	await page.getByTestId('issuer-name').fill(ISSUER);
	await page.getByTestId('issuer-address').fill('Musterstraße 1\n12345 Musterstadt');
	await page.getByTestId('crypto-eth').fill('0x0000000000000000000000000000000000000001');
	await page.getByTestId('save-settings').click();
	await expect(page.getByRole('status').first()).toContainText('Gespeichert');
	await issueInvoice(page);

	// The backup section: this key's address, and the paying account.
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	const section = page.getByTestId('backup');
	await expect(section.getByTestId('backup-address')).toHaveText(/0x[0-9a-fA-F]{40}/);
	const address = /** @type {string} */ (
		await section.getByTestId('backup-address').textContent()
	).trim();
	await expect(section.getByTestId('backup-row')).toHaveCount(0);

	await section.getByTestId('backup-owner').fill(OWNER.toLowerCase());
	await section.getByTestId('backup-owner-save').click();
	// Kept in EIP-55 form, as Aleph keys accounts.
	await expect(section.getByTestId('backup-owner')).toHaveValue(OWNER);

	// Not granted yet: the command that grants it, with this key's address.
	await expect(section.getByTestId('backup-not-granted')).toBeVisible();
	await expect(section.getByTestId('backup-grant-command')).toHaveText(
		`pnpm setup:aleph -- --authorize ${address} --channel INVOICE-BACKUP`
	);
	await expect(section.getByTestId('backup-now')).toBeDisabled();

	// What `pnpm setup:aleph -- --authorize` does, done in the fake.
	aleph.grant(OWNER, { address, types: ['STORE'], channels: ['INVOICE-BACKUP'], chain: 'ETH' });
	await section.getByTestId('backup-check').click();
	await expect(section.getByTestId('backup-granted')).toBeVisible();
	await expect(section.getByTestId('backup-credits')).toHaveText('0 Credits');

	// No credits: Aleph keeps nothing, and the page says how many it takes.
	await section.getByTestId('backup-now').click();
	await expect(section.getByTestId('backup-error')).toContainText(
		/Auf dem Konto sind 0 Credits, für einen Tag braucht diese Sicherung \d+/,
		{ timeout: 60_000 }
	);
	await expect(section.getByTestId('backup-row')).toHaveCount(0);

	// Credits on the account, and the same button keeps it.
	aleph.fund(OWNER, 1_000_000);
	await section.getByTestId('backup-now').click();
	await expect(section.getByTestId('backup-made')).toContainText('von Aleph aufbewahrt', {
		timeout: 60_000
	});
	await expect(section.getByTestId('backup-error')).toHaveCount(0);
	await expect(section.getByTestId('backup-row')).toHaveCount(1);
	await expect(section.getByTestId('backup-credits')).toHaveText('1.000.000 Credits');

	// What went up: the vault in front, as this browser keeps it; the books sealed.
	expect(aleph.added.size).toBe(2); // the refused one, and the kept one
	const [cid, bytes] = /** @type {[string, Uint8Array]} */ ([...aleph.added].at(-1));
	const { header } = readAppBackupHeader(bytes);
	const stored = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('invoice.vaults.v1') ?? 'null')
	);
	expect(JSON.parse(new TextDecoder().decode(header))).toEqual(stored[0]);
	for (const marker of [CUSTOMER, ISSUER, 'Serverbetrieb']) {
		expect(Buffer.from(bytes).toString('latin1')).not.toContain(marker);
	}
	await expect(section.getByTestId('backup-row').first()).toContainText(cid);

	// The STORE: signed by this key, for the paying account, paid in credits.
	expect(aleph.stores.at(-1)).toMatchObject({
		sender: address,
		owner: OWNER,
		cid,
		channel: 'INVOICE-BACKUP',
		payment: 'credit',
		status: 'processed'
	});

	// The history is in the sealed settings: still there after locking and unlocking.
	await page.getByTestId('lock').click();
	await page.getByTestId('passkey-unlock').click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	await expect(page.getByTestId('backup').getByTestId('backup-row')).toHaveCount(1);
	await expect(page.getByTestId('backup').getByTestId('backup-owner')).toHaveValue(OWNER);
});
