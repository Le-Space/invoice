import { describe, expect, it } from 'vitest';
import { documentModel, dueDay, formatDay, formatIban } from './document.js';
import { emptyDraft, emptyLine, issue } from './records.js';

const LABELS = {
	title: 'Rechnung',
	titleCancellation: 'Stornorechnung',
	invoiceDate: 'Rechnungsdatum',
	deliveryDate: 'Leistungsdatum',
	dueDate: 'Fälligkeitsdatum',
	customerNumber: 'Kundennr.',
	cancels: 'Storniert Rechnung',
	position: 'Pos.',
	description: 'Beschreibung',
	quantity: 'Menge',
	unit: 'Einheit',
	unitPrice: 'Einzelpreis',
	vat: 'USt.',
	lineNet: 'Betrag',
	subtotal: 'Zwischensumme ohne USt.',
	vatOf: 'USt. {rate} % von {base}',
	totalCurrency: 'Gesamt EUR',
	amountDue: 'Zu zahlender Betrag EUR',
	netNote: 'Einzelpreise und Beträge netto in EUR.',
	vatId: 'USt.-IdNr.:',
	taxNumber: 'Steuernr.:',
	register: 'Handelsregister:',
	registerCourt: 'Registergericht:',
	managingDirector: 'Geschäftsführer:',
	email: 'E-Mail:',
	phone: 'Telefon:',
	web: 'Webseite:',
	bank: 'Bank:',
	iban: 'IBAN:',
	bic: 'BIC:',
	accountHolder: 'Kontoinhaber:',
	btc: 'Bitcoin:',
	eth: 'Ethereum:',
	reference: 'Rechnung',
	giroCaption: 'GiroCode',
	giroHint:
		'Mit dem GiroCode übernimmt Ihre Banking-App Empfänger, IBAN, Betrag und Verwendungszweck.',
	paymentTerms:
		'Bitte überweisen Sie {amount} bis zum {date} und geben Sie die Rechnungsnummer {number} als Verwendungszweck an.',
	paymentOnReceipt: 'Zahlbar sofort nach Erhalt.',
	'invoice.note.kleinunternehmer': 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
	'invoice.note.reverseCharge': 'Steuerschuldnerschaft des Leistungsempfängers.'
};

const ISSUER = {
	name: 'Wolkenfabrik UG',
	address: 'Musterstraße 1\n12345 Musterstadt',
	vatId: 'DE000000000',
	taxNumber: '',
	email: 'buchhaltung@example.org',
	phone: '+49 000 000',
	web: 'https://example.org',
	bank: { name: 'Testbank', iban: 'DE89370400440532013000', bic: 'TESTDEFFXXX' },
	crypto: { btc: 'bc1qexample', eth: '' },
	register: { court: 'Amtsgericht Musterstadt', number: 'HRB 00000', managingDirector: 'Erika Mustermann' },
	logo: ''
};

function issued(/** @type {any} */ changes = {}) {
	const draft = {
		...emptyDraft({ issueDate: '2026-09-24' }),
		customer: { name: 'Stromwerk Test AG', address: 'Beispielweg 2\n54321 Beispielstadt am See', vatId: '' },
		lines: [
			emptyLine({ description: 'Tagessatz', quantity: 2, unit: 'Tage', unitPriceCents: 50_000 })
		],
		paymentTermsDays: 14,
		...changes
	};
	return issue(draft, { number: '2026-48213-001', issuer: ISSUER, issuedBy: 'did:key:z6Mkha' });
}

describe('dates', () => {
	it('writes a German date, and names the month in English', () => {
		expect(formatDay('2026-09-24')).toBe('24.09.2026');
		expect(formatDay('2026-09-24', 'en')).toBe('24 Sep 2026');
	});

	it('counts the payment days from the invoice date, across a month end', () => {
		expect(dueDay('2026-09-24', 14)).toBe('2026-10-08');
	});

	it('says nothing rather than something wrong', () => {
		expect(formatDay('')).toBe('');
		expect(dueDay('not a day', 14)).toBe('');
	});
});

describe('the header', () => {
	it('names the issuer, the register entry and how to reach them', () => {
		const { header } = documentModel(issued(), LABELS);
		expect(header[0]).toEqual({ label: '', value: 'Wolkenfabrik UG', strong: true });
		expect(header).toContainEqual({
			label: 'Handelsregister:',
			value: 'Amtsgericht Musterstadt, HRB 00000'
		});
		expect(header).toContainEqual({ label: 'USt.-IdNr.:', value: 'DE000000000' });
		expect(header).toContainEqual({ label: 'Webseite:', value: 'https://example.org' });
	});

	it('leaves out what nobody filled in', () => {
		const { header } = documentModel(issued(), LABELS);
		expect(header.some((line) => line.label === 'Steuernr.:')).toBe(false);
	});

	it('splits an address into the lines it was typed as', () => {
		// A stray newline reaches the PDF as a '?'.
		const { recipient, sender } = documentModel(issued(), LABELS);
		expect(recipient).toEqual(['Stromwerk Test AG', 'Beispielweg 2', '54321 Beispielstadt am See']);
		expect(sender).toBe('Wolkenfabrik UG · Musterstraße 1 · 12345 Musterstadt');
	});
});

describe('the invoice itself', () => {
	it('lists what is charged, with the unit in its own column', () => {
		const { rows, columns } = documentModel(issued(), LABELS);
		expect(columns).toEqual([
			'Pos.',
			'Beschreibung',
			'Menge',
			'Einheit',
			'Einzelpreis',
			'USt.',
			'Betrag'
		]);
		expect(rows).toEqual([
			{
				position: '1',
				description: 'Tagessatz',
				subtitle: '',
				details: [],
				quantity: '2',
				unit: 'Tage',
				unitPrice: '500,00',
				vat: '19 %',
				net: '1.000,00'
			}
		]);
	});

	it('carries the subtitle and the bullets that explain a line', () => {
		// What an invoice a customer can check looks like: the line, what it
		// was about, and what was actually done.
		const model = documentModel(
			issued({
				lines: [
					emptyLine({
						description: 'Beratung für künstliche Intelligenz',
						subtitle: 'Doichain Core 31.1 · Aufwand 9,5 Std.',
						details: ['LWMA und DigiShield erklärt', '  ', 'Mainnet-Node synchronisiert'],
						quantity: 1,
						unit: 'Tag',
						unitPriceCents: 50_000
					})
				]
			}),
			LABELS
		);
		expect(model.rows[0].subtitle).toBe('Doichain Core 31.1 · Aufwand 9,5 Std.');
		// A blank bullet is somebody's stray newline, not a bullet.
		expect(model.rows[0].details).toEqual([
			'LWMA und DigiShield erklärt',
			'Mainnet-Node synchronisiert'
		]);
	});

	it('adds up to the amount due, the way the template says it', () => {
		const { totals } = documentModel(issued(), LABELS);
		expect(totals).toEqual([
			{ label: 'Zwischensumme ohne USt.', value: '1.000,00\u00A0€' },
			{ label: 'USt. 19 % von 1.000,00\u00A0€', value: '190,00\u00A0€' },
			{ label: 'Gesamt EUR', value: '1.190,00\u00A0€', strong: true },
			{ label: 'Zu zahlender Betrag EUR', value: '1.190,00\u00A0€', due: true }
		]);
	});

	it('puts the delivery date under the table, not in the head', () => {
		// §14 Abs. 4 Nr. 6 UStG wants it on the invoice; where is ours to choose,
		// and the head is where somebody looks for the number and the dates
		// they act on.
		const { meta, deliveryNote } = documentModel(issued(), LABELS);
		expect(meta.some(([label]) => label === 'Leistungsdatum')).toBe(false);
		expect(deliveryNote).toBe('Leistungsdatum 24.09.2026');
	});

	it('names the customer number where the customer has one', () => {
		const withNumber = issued({
			customer: { number: '1', name: 'Stromwerk Test AG', address: 'Probehausen', vatId: '' }
		});
		expect(documentModel(withNumber, LABELS).meta).toContainEqual(['Kundennr.', '1']);
		// And says nothing where they have none, rather than printing a blank.
		expect(documentModel(issued(), LABELS).meta.some(([l]) => l === 'Kundennr.')).toBe(false);
	});

	it('names the day, the amount and the invoice number in the payment sentence', () => {
		const { payment, meta } = documentModel(issued(), LABELS);
		expect(payment).toBe(
			'Bitte überweisen Sie 1.190,00\u00A0€ bis zum 08.10.2026 und geben Sie die Rechnungsnummer 2026-48213-001 als Verwendungszweck an.'
		);
		expect(meta).toContainEqual(['Fälligkeitsdatum', '08.10.2026']);
	});

	it('carries the §19 sentence and shows no VAT at all', () => {
		const model = documentModel(issued({ taxMode: 'kleinunternehmer' }), LABELS);
		expect(model.note).toContain('§ 19 UStG');
		expect(model.totals.map((row) => row.label)).toEqual([
			'Zwischensumme ohne USt.',
			'Gesamt EUR',
			'Zu zahlender Betrag EUR'
		]);
	});

	it('calls a Storno a Storno and names what it takes back', () => {
		const model = documentModel({ ...issued(), cancels: '2026-48213-000' }, LABELS);
		expect(model.title).toBe('Stornorechnung');
		expect(model.meta).toContainEqual(['Storniert Rechnung', '2026-48213-000']);
	});
});

describe('the GiroCode', () => {
	it('carries the amount and the invoice number as the reference', () => {
		const { giro } = documentModel(issued(), LABELS);
		const lines = (giro?.payload ?? '').split('\n');
		expect(lines[6]).toBe('DE89370400440532013000');
		expect(lines[7]).toBe('EUR1190.00');
		expect(lines[10]).toBe('Rechnung 2026-48213-001');
	});

	it('is absent where there is no account to pay into', () => {
		const model = documentModel(
			{ ...issued(), issuer: { ...ISSUER, bank: { name: '', iban: '', bic: '' } } },
			LABELS
		);
		expect(model.giro).toBeNull();
	});

	it('is absent on a Storno, which owes money the other way', () => {
		const storno = issued({
			lines: [emptyLine({ description: 'Tagessatz', quantity: -2, unitPriceCents: 50_000 })]
		});
		expect(documentModel(storno, LABELS).giro).toBeNull();
	});
});

describe('the footer', () => {
	it('prints an IBAN in the groups people read it in', () => {
		expect(formatIban('DE89370400440532013000')).toBe('DE89 3704 0044 0532 0130 00');
		expect(formatIban('de89 3704 0044 0532 0130 00')).toBe('DE89 3704 0044 0532 0130 00');
		expect(formatIban('')).toBe('');
	});

	it('carries the three lines every page of the template carries', () => {
		const { footer } = documentModel(issued(), LABELS);
		const text = footer.map((line) => line.map((cell) => `${cell.label} ${cell.value}`.trim()));
		expect(text[0]).toContain('Wolkenfabrik UG');
		expect(text[1]).toContain('Geschäftsführer: Erika Mustermann');
		expect(text[2]).toContain('IBAN: DE89 3704 0044 0532 0130 00');
	});

	it('takes crypto accounts along when they are filled in', () => {
		const { footer } = documentModel(issued(), LABELS);
		expect(footer[3]).toEqual([{ label: 'Bitcoin:', value: 'bc1qexample' }]);
	});

	it('drops a line nobody filled in rather than printing empty labels', () => {
		const bare = {
			...issued(),
			issuer: { name: 'Einzelunternehmen', address: 'Irgendwo', vatId: 'DE1' }
		};
		const { footer } = documentModel(bare, LABELS);
		expect(footer).toHaveLength(2);
		expect(footer.flat().every((cell) => cell.value !== '')).toBe(true);
	});
});
