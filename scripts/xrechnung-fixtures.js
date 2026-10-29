/**
 * Made-up invoices, issued and written as XRechnung, for KoSIT to check in CI
 * (`scripts/kosit.sh`) and for the core's round-trip spec.
 *
 * One per case the app can produce: 19 %, 7 % with a discount line, 0 %,
 * reverse charge to another EU country, a small business under § 19 UStG, a
 * Storno, a public body with its Leitweg-ID, and an invoice in US dollars that
 * states its VAT in euros. Every name, address, number and account is
 * invented; the IBAN is KoSIT's own test dummy.
 *
 *   node scripts/xrechnung-fixtures.js <directory>
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cancellationFor, emptyDraft, emptyLine, issue } from '../src/core/records.js';
import { emptyIssuer } from '../src/core/settings.js';
import { xrechnungXml } from '../src/core/xrechnung.js';

/** The issuer of every fixture: a made-up company, KoSIT's dummy IBAN. */
export const FIXTURE_ISSUER = emptyIssuer({
	name: 'Wolkenfabrik Hosting GmbH',
	address: 'Musterstraße 1\n12345 Musterstadt',
	postcode: '12345',
	city: 'Musterstadt',
	country: 'DE',
	contactName: 'Erika Mustermann',
	phone: '+49 30 1234567',
	email: 'rechnung@example.com',
	vatId: 'DE123456789',
	taxNumber: '12/345/67890',
	bank: { name: 'Beispielbank', iban: 'DE79 0000 0000 1234 5678 90', bic: '' },
	register: { court: 'Amtsgericht Musterstadt', number: 'HRB 12345', managingDirector: '' }
});

/** A customer who wants an XRechnung, in Germany unless said otherwise. */
const customer = (/** @type {Record<string, string>} */ values = {}) => ({
	number: 'K-1001',
	name: 'Beispiel Kunde GmbH',
	address: 'Kundenweg 7\n54321 Beispielstadt',
	postcode: '54321',
	city: 'Beispielstadt',
	country: 'DE',
	vatId: '',
	email: 'buchhaltung@example.org',
	buyerReference: 'Bestellung 4711',
	eInvoice: /** @type {'xrechnung'} */ ('xrechnung'),
	...values
});

/**
 * @param {string} number
 * @param {Parameters<typeof emptyDraft>[0] & Record<string, any>} values
 * @param {typeof FIXTURE_ISSUER} [issuer]
 */
function issued(number, { lines, ...values }, issuer = FIXTURE_ISSUER) {
	const draft = {
		...emptyDraft({ issueDate: '2026-10-20' }),
		deliveryDate: '2026-10-15',
		customer: customer(),
		...values,
		lines
	};
	return issue(draft, {
		number,
		issuer,
		issuedBy: 'did:key:z6MkExample',
		issuedAt: '2026-10-20T09:00:00.000Z'
	});
}

/** @returns {{ name: string, invoice: any }[]} */
export function fixtures() {
	const standard = issued('2026-00000-001', {
		notes: 'Leistungszeitraum Oktober & November <Projekt Wolke>',
		lines: [
			emptyLine({
				description: 'Beratung',
				subtitle: 'Architektur der Ablage',
				details: ['Workshop', 'Protokoll'],
				quantity: 6.5,
				unit: 'Stunde',
				unitPrice: '9500',
				vatRate: 19
			}),
			emptyLine({ description: 'Einrichtung', quantity: 1, unit: 'Pauschale', unitPrice: '25000' })
		]
	});
	return [
		{ name: '01-standard-19', invoice: standard },
		{
			name: '02-reduced-7-with-discount',
			invoice: issued('2026-00000-002', {
				lines: [
					emptyLine({
						description: 'Fachbuch',
						quantity: 3,
						unit: 'Stück',
						unitPrice: '3990',
						vatRate: 7
					}),
					emptyLine({
						description: 'Wartung',
						quantity: 1,
						unit: 'Monat',
						unitPrice: '12000',
						vatRate: 19
					}),
					emptyLine({
						description: 'Nachlass Wartung',
						quantity: -1,
						unit: 'Monat',
						unitPrice: '1200',
						vatRate: 19
					})
				]
			})
		},
		{
			name: '03-zero-rated',
			invoice: issued('2026-00000-003', {
				lines: [
					emptyLine({
						description: 'Solarmodul',
						quantity: 4,
						unit: 'Stück',
						unitPrice: '21000',
						vatRate: 0
					}),
					emptyLine({
						description: 'Anfahrt',
						quantity: 120,
						unit: 'km',
						unitPrice: '50',
						vatRate: 19
					})
				]
			})
		},
		{
			name: '04-reverse-charge',
			invoice: issued('2026-00000-004', {
				taxMode: 'reverse-charge',
				customer: customer({
					name: 'Muster Handels GmbH',
					address: 'Probegasse 3\n1010 Wien\nÖsterreich',
					postcode: '1010',
					city: 'Wien',
					country: 'AT',
					vatId: 'ATU12345678'
				}),
				lines: [
					emptyLine({ description: 'Hosting', quantity: 12, unit: 'Monat', unitPrice: '4900' })
				]
			})
		},
		{
			name: '05-kleinunternehmer',
			invoice: issued(
				'2026-00000-005',
				{
					taxMode: 'kleinunternehmer',
					lines: [
						emptyLine({ description: 'Fotografie', quantity: 1, unit: 'Tag', unitPrice: '48000' })
					]
				},
				// A small business has a tax number, rarely a VAT id.
				emptyIssuer({ ...FIXTURE_ISSUER, vatId: '' })
			)
		},
		{
			name: '06-storno',
			invoice: issue(cancellationFor(standard, { issueDate: '2026-10-22' }), {
				number: '2026-00000-006',
				issuer: FIXTURE_ISSUER,
				issuedBy: 'did:key:z6MkExample',
				issuedAt: '2026-10-22T09:00:00.000Z'
			})
		},
		{
			name: '07-public-body-leitweg-id',
			invoice: issued('2026-00000-007', {
				customer: customer({
					number: '',
					name: 'Stadtverwaltung Beispielstadt',
					address: 'Rathausplatz 1\n54321 Beispielstadt',
					email: 'erechnung@example.org',
					buyerReference: '04011000-12345-03'
				}),
				paymentTermsDays: 30,
				lines: [
					emptyLine({ description: 'Schulung', quantity: 2, unit: 'Tag', unitPrice: '95000' })
				]
			})
		},
		{
			name: '08-usd-vat-in-euro',
			invoice: issued('2026-00000-008', {
				currency: 'USD',
				eurRate: {
					eurPerUnit: '0.9132',
					source: 'BMF-Umsatzsteuer-Umrechnungskurse',
					date: '2026-10-01'
				},
				lines: [
					emptyLine({ description: 'Lizenz', quantity: 5, unit: 'Stück', unitPrice: '19900' })
				]
			})
		}
	];
}

/** Writes every fixture as `<name>.xml` into `directory`. @param {string} directory */
export async function writeFixtures(directory) {
	await mkdir(directory, { recursive: true });
	for (const { name, invoice } of fixtures()) {
		await writeFile(join(directory, `${name}.xml`), xrechnungXml(invoice));
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const directory = process.argv[2];
	if (!directory) {
		console.error('usage: node scripts/xrechnung-fixtures.js <directory>');
		process.exit(2);
	}
	await writeFixtures(directory);
	console.log(`${fixtures().length} XRechnung fixtures in ${directory}`);
}
