// The invoice app as a UCEP provider, reached through a relay the way Belege
// will reach it: an app paired by invitation gets an Eigenbeleg, a stranger
// gets nothing, an app paired by code comes through the human's yes, and an
// unpaired app is refused again. The peer id stays over a reload. Since 0.2.0
// the paired app also reads an issued invoice and reports it paid, and the
// invoice list says so.
import { test, expect } from '@playwright/test';
import { createConsumer } from '@le-space/ucep';
import { addVirtualAuthenticator } from './webauthn.js';
import { relayAddr, startConsumerNode } from './relay.js';
import { everythingStoredAsText, spellings } from './storage-scan.js';
import { parseInvitation } from '@le-space/ucep';

/** The spec's example (extensions/invoice.md), made-up data. */
const args = {
	date: '2026-09-01',
	direction: 'outgoing',
	reason: 'Das Netzwerk berechnet Gebühren on-chain und stellt keine Rechnung aus.',
	description: 'Netzwerkgebühr für eine Lease-Zahlung',
	amount: { value: '12.34', currency: 'EUR' },
	crypto: {
		chain: 'cosmos:akashnet-2',
		symbol: 'AKT',
		quantity: '4.200000',
		txRef: '0'.repeat(64),
		valuation: { rate: '2.938095', source: 'coingecko:history', at: '2026-09-01T12:00:00+00:00' }
	},
	reference: { system: 'belege', id: '01J0000000000000000000000A' }
};

test('a paired app gets an Eigenbeleg through the relay, a stranger does not', async ({ page }) => {
	const relay = await relayAddr();
	/** @type {any[]} */
	const nodes = [];
	try {
		await addVirtualAuthenticator(page);
		await page.goto('/');
		await page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(page.getByTestId('own-did')).toBeVisible();

		await page.getByRole('link', { name: 'Einstellungen' }).click();
		await page.getByTestId('issuer-name').fill('Wolkenfabrik Hosting UG');
		await page.getByTestId('issuer-address').fill('Musterstraße 1\n12345 Musterstadt');
		await page.getByTestId('save-settings').click();
		await expect(page.getByRole('status')).toContainText('Gespeichert');

		// Not paired yet: nothing connects to the relay until asked.
		await page.getByRole('link', { name: 'Verbindungen' }).click();
		await expect(page.getByTestId('ucep-start')).toBeVisible();
		// What going online means is said before anybody clicks.
		await expect(page.getByTestId('ucep-privacy')).toContainText('Ende zu Ende verschlüsselt');
		await expect(page.getByTestId('ucep-privacy')).toContainText('api.aleph.im');
		await expect(page.getByTestId('ucep-peer-id')).toHaveCount(0);
		await page.getByTestId('ucep-start').click();
		// Then the app is reachable through the relay.
		await expect(page.getByTestId('ucep-online')).toHaveAttribute('data-online', 'true');
		const providerId = /** @type {string} */ (await page.getByTestId('ucep-peer-id').textContent());
		expect(providerId).toMatch(/^12D3Koo/);
		const through = `${relay}/p2p-circuit/p2p/${providerId}`;

		// Belege pairs with an invitation it was handed.
		await page.getByTestId('create-invitation').click();
		const uri = await page.getByTestId('invitation-uri').inputValue();
		expect(uri).toMatch(/^web\+ucep:pair\?/);
		// Every scope is offered, the ones of 0.2.0 too.
		expect(parseInvitation(uri).scopes).toEqual([
			'invoice:eigenbeleg:create',
			'invoice:document:read',
			'invoice:issued:read',
			'invoice:payment:record'
		]);
		// Only the app through its relay: no private addresses, a sparse QR code.
		const offered = parseInvitation(uri).addrs;
		expect(offered.length).toBeGreaterThan(0);
		expect(offered.every((addr) => addr.startsWith(`${relay}/p2p-circuit/`))).toBe(true);
		const belegeNode = await startConsumerNode(relay);
		nodes.push(belegeNode);
		const belege = createConsumer({ libp2p: belegeNode, label: 'Belege E2E' });
		await belege.start();
		// The app's human confirms: the same six digits on both sides.
		/** @type {string} */
		let belegeCode = '';
		const pairedBelege = belege.pairWithInvitation(uri, {
			onCode: (/** @type {string} */ code) => (belegeCode = code)
		});
		const asking = page.getByTestId('pending-pairing').filter({ hasText: 'Belege E2E' });
		await expect(asking).toBeVisible();
		await expect.poll(() => belegeCode).toMatch(/^\d{6}$/);
		await asking.getByTestId('pairing-code').fill(belegeCode);
		await asking.getByTestId('approve-pairing').click();
		await pairedBelege;
		await expect(page.getByTestId('grant').filter({ hasText: 'Belege E2E' })).toBeVisible();

		const created = await belege.call(providerId, 'invoice', 'create-eigenbeleg', args);
		expect(created).toMatchObject({
			state: 'created',
			number: expect.stringMatching(/^EB-\d{4}-0001$/)
		});
		const status = await belege.call(providerId, 'invoice', 'status', {
			documentId: created.documentId
		});
		expect(status).toMatchObject({ kind: 'eigenbeleg', number: created.number });
		// Through the relay the connection is limited: the PDF is named, not sent.
		const pdf = await belege.call(providerId, 'invoice', 'get-pdf', {
			documentId: created.documentId
		});
		expect(pdf).toMatchObject({ mime: 'application/pdf', sha256: created.file.sha256 });

		// The app lists it, and prints it.
		await page.getByRole('link', { name: 'Rechnungen', exact: true }).click();
		const row = page.getByTestId('invoice-row').filter({ hasText: created.number });
		await expect(row).toContainText('Eigenbeleg');
		await expect(row).toContainText('12,34');
		await row.getByRole('link').click();
		await expect(page.getByTestId('eigenbeleg')).toContainText('Belege E2E');
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByTestId('download-pdf').click()
		]);
		expect(download.suggestedFilename()).toBe(`Eigenbeleg-${created.number}.pdf`);

		// An invoice issued here: Belege lists it, and reports it paid.
		await page.getByRole('link', { name: 'Rechnungen', exact: true }).click();
		await page.getByTestId('new-invoice').click();
		await page.getByTestId('customer-name').fill('Beispiel Kunde GmbH');
		await page.getByTestId('customer-address').fill('Beispielweg 2\n54321 Beispielstadt');
		await page.getByTestId('line-description').fill('Beratung');
		await page.getByTestId('line-price').fill('100');
		page.once('dialog', (dialog) => dialog.accept());
		await page.getByTestId('issue').click();
		await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', 'open');
		const listed = await belege.call(providerId, 'invoice', 'list-issued', {});
		expect(listed.invoices).toHaveLength(1);
		const [invoice] = listed.invoices;
		expect(invoice).toMatchObject({
			state: 'issued',
			customer: { name: 'Beispiel Kunde GmbH' },
			total: { value: '119.00', currency: 'EUR' },
			payments: []
		});
		const paid = await belege.call(providerId, 'invoice', 'record-payment', {
			documentId: invoice.documentId,
			paidOn: invoice.issuedOn,
			amount: { value: '119.00', currency: 'EUR' },
			reference: { system: 'belege', id: '01J0000000000000000000000D' }
		});
		expect(paid).toMatchObject({ state: 'paid', open: { value: '0.00' } });
		await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', 'paid');
		await expect(page.getByTestId('payment')).toContainText('gemeldet von Belege E2E');
		await page.getByRole('link', { name: 'Rechnungen', exact: true }).click();
		await expect(page.getByTestId('invoice-row').filter({ hasText: invoice.number })).toContainText(
			'bezahlt am'
		);

		// Sealed at rest: nothing of the pairing or the Eigenbeleg is readable on disk.
		{
			const secret = Buffer.from(parseInvitation(uri).secret).toString('hex');
			const { text } = await everythingStoredAsText(page);
			for (const plain of [
				'Belege E2E',
				created.number,
				'on-chain und stellt keine',
				'Wolkenfabrik'
			]) {
				expect(text).not.toContain(plain);
			}
			expect(text).not.toContain(belegeNode.peerId.toString());
			for (const form of spellings(secret)) expect(text).not.toContain(form);
		}

		// A stranger reaches the app, learns what it serves, and gets nothing.
		const strangerNode = await startConsumerNode(relay);
		nodes.push(strangerNode);
		const stranger = createConsumer({ libp2p: strangerNode, label: 'Fremd' });
		await stranger.start();
		await stranger.addProvider(through);
		const help = await stranger.call(providerId, 'invoice', 'help', {});
		expect(help.commands.length).toBeGreaterThan(1);
		await expect(
			stranger.call(providerId, 'invoice', 'create-eigenbeleg', args)
		).rejects.toMatchObject({ code: 'PAIRING_REQUIRED' });

		// Pairing by code: the app opens a window, the codes match, its human says yes.
		await page.getByRole('link', { name: 'Verbindungen' }).click();
		await page.getByTestId('open-window').click();
		/** @type {string} */
		let shown = '';
		const paired = stranger.pairInBand(providerId, 'invoice', {
			scopes: ['invoice:eigenbeleg:create'],
			onCode: (/** @type {string} */ code) => (shown = code)
		});
		const pending = page.getByTestId('pending-pairing').filter({ hasText: 'Fremd' });
		await expect(pending).toBeVisible();
		await expect.poll(() => shown).toMatch(/^\d{6}$/);
		await pending.getByTestId('pairing-code').fill(shown);
		await pending.getByTestId('approve-pairing').click();
		await paired;
		await expect(page.getByTestId('grant').filter({ hasText: 'Fremd' })).toBeVisible();
		const second = await stranger.call(providerId, 'invoice', 'create-eigenbeleg', args);
		expect(second.number).toMatch(/-0002$/);

		// Unpaired: refused again.
		await page.getByTestId('grant').filter({ hasText: 'Fremd' }).getByTestId('unpair').click();
		await expect(page.getByTestId('grant').filter({ hasText: 'Fremd' })).toHaveCount(0);
		await expect(
			stranger.call(providerId, 'invoice', 'create-eigenbeleg', args)
		).rejects.toMatchObject({ code: 'PAIRING_REQUIRED' });

		// The same peer id after a reload, connected without being asked (an app
		// is paired): the paired app still finds it, the grant still holds.
		await page.reload();
		await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
		await page.getByRole('link', { name: 'Verbindungen' }).click();
		await expect(page.getByTestId('ucep-peer-id')).toHaveText(providerId);
		await expect(page.getByTestId('ucep-online')).toHaveAttribute('data-online', 'true');
		await expect(page.getByTestId('grant').filter({ hasText: 'Belege E2E' })).toBeVisible();
		await belege.addProvider(through);
		const third = await belege.call(providerId, 'invoice', 'status', {
			documentId: created.documentId
		});
		expect(third.number).toBe(created.number);
	} finally {
		await Promise.all(nodes.map((node) => node.stop().catch(() => {})));
	}
});
