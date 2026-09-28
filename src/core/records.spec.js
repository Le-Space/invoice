import { describe, expect, it } from 'vitest';
import {
	cancellationFor,
	draftProblems,
	emptyDraft,
	emptyLine,
	foldCancellations,
	invoiceKey,
	isInvoiceKey,
	issue,
	requiredNoteCode,
	draftWarnings,
	moneyUnit,
	setCurrency,
	totalsDisagree,
	upgradeInvoice
} from './records.js';
import { INVOICE_CURRENCIES } from './currency.js';

const ISSUER = {
	name: 'Wolkenfabrik Hosting UG (haftungsbeschränkt)',
	address: 'Musterstadt',
	vatId: 'DE000000000',
	crypto: { eth: '0x0000000000000000000000000000000000000001' }
};

const codes = (/** @type {{ code: string }[]} */ problems) => problems.map((p) => p.code);

/** A draft that is ready to be issued, so each test can break exactly one thing. */
function readyDraft(/** @type {Partial<ReturnType<typeof emptyDraft>>} */ changes = {}) {
	return {
		...emptyDraft(),
		customer: { name: 'Stromwerk Test AG', address: 'Probehausen', vatId: '' },
		lines: [emptyLine({ description: 'Tagessatz', quantity: 2, unit: 'Tage', unitPrice: '50000' })],
		...changes
	};
}

describe('keys', () => {
	it('keeps invoices out of the todo list', () => {
		expect(isInvoiceKey(invoiceKey('inv_1'))).toBe(true);
		expect(isInvoiceKey('todo_1759_abc')).toBe(false);
		expect(isInvoiceKey('delegation-action/todo_1/did/1')).toBe(false);
	});
});

describe('draftProblems', () => {
	it('passes a complete draft', () => {
		expect(draftProblems(readyDraft(), { issuer: ISSUER })).toEqual([]);
	});

	it('wants an issuer, because the invoice has to name who is charging', () => {
		expect(codes(draftProblems(readyDraft(), { issuer: { name: '', address: '' } }))).toContain(
			'invoice.problem.issuerMissing'
		);
	});

	it('wants the customer by name and address', () => {
		const draft = readyDraft({ customer: { name: '', address: '', vatId: '' } });
		expect(codes(draftProblems(draft, { issuer: ISSUER }))).toEqual([
			'invoice.problem.customerName',
			'invoice.problem.customerAddress'
		]);
	});

	it('wants the recipient’s VAT id before it shifts the tax to them', () => {
		const draft = readyDraft({ taxMode: 'reverse-charge' });
		expect(codes(draftProblems(draft, { issuer: ISSUER }))).toContain(
			'invoice.problem.customerVatId'
		);
	});

	it('wants the delivery date, not only the invoice date', () => {
		const draft = readyDraft({ deliveryDate: '' });
		expect(codes(draftProblems(draft, { issuer: ISSUER }))).toContain(
			'invoice.problem.deliveryDate'
		);
	});

	it('refuses an invoice with nothing on it', () => {
		const draft = readyDraft({ lines: [] });
		expect(codes(draftProblems(draft, { issuer: ISSUER }))).toContain('invoice.problem.noLines');
	});

	it('names the line that is wrong', () => {
		const draft = readyDraft({
			lines: [emptyLine({ description: 'Tagessatz', unitPrice: '1' }), emptyLine()]
		});
		const problems = draftProblems(draft, { issuer: ISSUER });
		expect(problems).toContainEqual({
			code: 'invoice.problem.lineDescription',
			field: 'description',
			line: 1
		});
	});

	it('allows only VAT rates a German invoice may carry', () => {
		const draft = readyDraft({
			lines: [emptyLine({ description: 'Beratung', unitPrice: '100', vatRate: 12 })]
		});
		expect(codes(draftProblems(draft, { issuer: ISSUER }))).toContain(
			'invoice.problem.lineVatRate'
		);
	});

	it('leaves the rate alone where no VAT is shown at all', () => {
		const draft = readyDraft({
			taxMode: 'kleinunternehmer',
			lines: [emptyLine({ description: 'Beratung', unitPrice: '100', vatRate: 12 })]
		});
		expect(draftProblems(draft, { issuer: ISSUER })).toEqual([]);
	});
});

describe('issue', () => {
	it('assigns the number and freezes what the document shows', () => {
		const draft = readyDraft();
		const invoice = issue(draft, {
			number: '2026-48213-001',
			issuer: ISSUER,
			issuedBy: 'did:key:z6Mkha'
		});

		expect(invoice.state).toBe('issued');
		expect(invoice.number).toBe('2026-48213-001');
		expect(invoice.issuer.name).toBe(ISSUER.name);
		expect(invoice.currency).toBe('EUR');
		expect(invoice.totals).toEqual({
			net: '100000',
			tax: '19000',
			gross: '119000',
			vatBreakdown: [{ category: 'S', rate: 19, taxable: '100000', tax: '19000' }]
		});
	});

	it('keeps a copy of the customer, so a move does not rewrite last year', () => {
		const draft = readyDraft();
		const invoice = issue(draft, { number: '2026-48213-001', issuer: ISSUER, issuedBy: 'did' });
		draft.customer.address = 'Somewhere else';
		expect(invoice.customer.address).toBe('Probehausen');
	});

	it('carries the note its tax mode requires', () => {
		const invoice = issue(readyDraft({ taxMode: 'kleinunternehmer' }), {
			number: '2026-48213-001',
			issuer: ISSUER,
			issuedBy: 'did'
		});
		expect(invoice.noteCode).toBe(requiredNoteCode('kleinunternehmer'));
		expect(invoice.totals.tax).toBe('0');
	});

	it('refuses to issue what is not ready, and to issue without a number', () => {
		expect(() =>
			issue(readyDraft({ lines: [] }), { number: '1', issuer: ISSUER, issuedBy: 'did' })
		).toThrow();
		expect(() => issue(readyDraft(), { number: '', issuer: ISSUER, issuedBy: 'did' })).toThrow();
	});
});

describe('totalsDisagree', () => {
	it('notices when an issued invoice no longer adds up', () => {
		const invoice = issue(readyDraft(), {
			number: '2026-48213-001',
			issuer: ISSUER,
			issuedBy: 'did'
		});
		expect(totalsDisagree(invoice)).toBe(false);
		expect(totalsDisagree({ ...invoice, lines: [{ ...invoice.lines[0], quantity: 3 }] })).toBe(
			true
		);
	});
});

describe('cancellationFor', () => {
	it('takes the amounts back instead of editing the invoice', () => {
		const invoice = issue(readyDraft(), {
			number: '2026-48213-001',
			issuer: ISSUER,
			issuedBy: 'did'
		});
		const storno = cancellationFor(invoice);

		expect(storno.cancels).toBe('2026-48213-001');
		expect(storno.state).toBe('draft');
		expect(storno.lines[0].quantity).toBe(-2);
		expect(storno.customer.name).toBe('Stromwerk Test AG');
	});

	it('cancels nothing that was never issued', () => {
		expect(() => cancellationFor(/** @type {never} */ (readyDraft()))).toThrow();
	});
});

describe('foldCancellations', () => {
	it('tells the reader which invoice was taken back, and by which', () => {
		const folded = foldCancellations([
			{ number: '2026-48213-001' },
			{ number: '2026-48213-002', cancels: '2026-48213-001' },
			{ number: '2026-48213-003' }
		]);
		expect(folded[0].cancelledBy).toBe('2026-48213-002');
		expect(folded[1].cancelledBy).toBeUndefined();
		expect(folded[2].cancelledBy).toBeUndefined();
	});
});

describe('an invoice in another currency', () => {
	const RATE = { eurPerUnit: '0.9123', source: 'Kraken', date: '2026-09-24' };
	/** 3 × 1.5 USDC on Base at 19 % */
	const usdc = (/** @type {any} */ changes = {}) =>
		readyDraft({
			...emptyDraft({ currency: 'USDC', issueDate: '2026-09-24' }),
			network: 'base',
			customer: { name: 'Stromwerk Test AG', address: 'Probehausen', vatId: '' },
			lines: [emptyLine({ description: 'Serverbetrieb', quantity: 3, unitPrice: '1500000' })],
			...changes
		});

	it('needs a euro rate once it shows VAT, because the VAT is owed in euros', () => {
		expect(codes(draftProblems(usdc(), { issuer: ISSUER }))).toEqual(['invoice.problem.eurRate']);
		expect(draftProblems(usdc({ eurRate: RATE }), { issuer: ISSUER })).toEqual([]);
		expect(
			codes(draftProblems(usdc({ eurRate: { ...RATE, source: ' ' } }), { issuer: ISSUER }))
		).toEqual(['invoice.problem.eurRate']);
		expect(
			codes(draftProblems(usdc({ eurRate: { ...RATE, eurPerUnit: '0' } }), { issuer: ISSUER }))
		).toEqual(['invoice.problem.eurRate']);
	});

	it('needs no rate where it shows no VAT', () => {
		const lines = [emptyLine({ description: 'Beratung', unitPrice: '10000', vatRate: 0 })];
		expect(draftProblems(usdc({ lines }), { issuer: ISSUER })).toEqual([]);
		expect(draftProblems(usdc({ taxMode: 'kleinunternehmer' }), { issuer: ISSUER })).toEqual([]);
	});

	it('needs an address to be paid to, valid on its chain', () => {
		const withRate = usdc({ eurRate: RATE });
		expect(draftProblems(withRate, { issuer: ISSUER })).toEqual([]);
		expect(codes(draftProblems(withRate, { issuer: { ...ISSUER, crypto: { eth: '' } } }))).toEqual([
			'invoice.problem.payAddress'
		]);
		// A Bitcoin address is no EVM address.
		expect(
			codes(
				draftProblems(withRate, {
					issuer: { ...ISSUER, crypto: { eth: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' } }
				})
			)
		).toEqual(['invoice.problem.payAddress']);
	});

	it('names the network it is paid on, one its currency is on', () => {
		expect(usdc().network).toBe('base');
		expect(
			codes(draftProblems(usdc({ eurRate: RATE, network: 'bitcoin' }), { issuer: ISSUER }))
		).toEqual(['invoice.problem.network']);
		// USDC is on several chains; switching to it picks the first, Ethereum.
		const inUsdc = setCurrency(readyDraft(), 'USDC');
		expect(inUsdc.network).toBe('ethereum');
		expect(setCurrency(usdc(), 'USDC').network).toBe('base');
		expect(setCurrency(inUsdc, 'EUR').network).toBeNull();
	});

	it('reads an invoice from before networks as paid on its currency’s first network', () => {
		const { network, ...older } = usdc();
		expect(upgradeInvoice(older).network).toBe('ethereum');
		expect(upgradeInvoice({ ...older, currency: 'EUR', decimals: 2 }).network).toBeNull();
	});

	it('refuses a currency it does not know', () => {
		expect(codes(draftProblems(readyDraft({ currency: 'XYZ' }), { issuer: ISSUER }))).toEqual([
			'invoice.problem.currency'
		]);
	});

	it('writes no new invoice in NYM or AKT, but still cancels one issued in them', () => {
		expect(INVOICE_CURRENCIES).not.toContain('NYM');
		expect(INVOICE_CURRENCIES).not.toContain('AKT');
		expect(INVOICE_CURRENCIES).toEqual(expect.arrayContaining(['EUR', 'BTC', 'ETH', 'USDC']));
		const inNym = usdc({ currency: 'NYM', network: 'nyx', eurRate: RATE });
		const legacyIssuer = { ...ISSUER, crypto: { nym: 'n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp8hacc' } };
		expect(codes(draftProblems(inNym, { issuer: legacyIssuer }))).toEqual([
			'invoice.problem.currencyRetired'
		]);
		expect(codes(draftProblems({ ...inNym, currency: 'AKT', network: 'akash' }))).toContain(
			'invoice.problem.currencyRetired'
		);
		expect(() =>
			issue(inNym, { number: '2026-00000-001', issuer: legacyIssuer, issuedBy: 'did' })
		).toThrow(/currencyRetired/);
		// Issued while NYM was still offered (a record as it was stored then).
		const issued = {
			...inNym,
			state: 'issued',
			number: '2026-00000-001',
			issuer: legacyIssuer,
			issuedBy: 'did'
		};
		const storno = cancellationFor(issued, { issueDate: '2026-09-25' });
		expect(storno.currency).toBe('NYM');
		expect(storno.network).toBe('nyx');
		expect(codes(draftProblems(storno, { issuer: ISSUER }))).not.toContain(
			'invoice.problem.currencyRetired'
		);
	});

	it('keeps its decimals on the record, and warns when the table has others now', () => {
		expect(usdc().decimals).toBe(6);
		expect(draftWarnings(usdc())).toEqual([]);
		// Written before the table changed: still openable, still issuable,
		// read in its own decimals — and worth a second look.
		const older = usdc({ decimals: 4, eurRate: RATE });
		expect(draftProblems(older, { issuer: ISSUER })).toEqual([]);
		expect(codes(draftWarnings(older))).toEqual(['invoice.warning.decimals']);
		const invoice = issue(older, { number: '2026-00000-001', issuer: ISSUER, issuedBy: 'did' });
		expect(invoice.decimals).toBe(4);
		expect(codes(draftProblems(usdc({ decimals: -1, eurRate: RATE }), { issuer: ISSUER }))).toEqual(
			['invoice.problem.currency']
		);
	});

	it('changes a draft’s currency with its decimals, keeping the figures it showed', () => {
		const eur = readyDraft({
			lines: [emptyLine({ description: 'Beratung', unitPrice: '150' })]
		});
		const inUsdc = setCurrency(eur, 'USDC');
		expect(inUsdc).toMatchObject({ currency: 'USDC', decimals: 6 });
		expect(inUsdc.lines[0].unitPrice).toBe('1500000');
		// Back to euros: fewer decimals, rounded once; the rate goes, it was for USDC.
		const back = setCurrency(
			{ ...inUsdc, eurRate: RATE, lines: [{ ...inUsdc.lines[0], unitPrice: '1505000' }] },
			'EUR'
		);
		expect(back).toMatchObject({ currency: 'EUR', decimals: 2, eurRate: null });
		expect(back.lines[0].unitPrice).toBe('151');
		// USDC to dollars: the USDC rate says nothing about dollars.
		expect(setCurrency({ ...inUsdc, eurRate: RATE }, 'USD').eurRate).toBeNull();
		expect(setCurrency({ ...inUsdc, eurRate: RATE }, 'USDC').eurRate).toEqual(RATE);
		expect(() => setCurrency(eur, 'XYZ')).toThrow();
	});

	it('wants the rate of the month the service was rendered in', () => {
		const lastMonth = { ...RATE, date: '2026-08-31' };
		expect(codes(draftProblems(usdc({ eurRate: lastMonth }), { issuer: ISSUER }))).toEqual([
			'invoice.problem.eurRateMonth'
		]);
	});

	it('reads an issued invoice in the decimals it was issued with', () => {
		const invoice = issue(usdc({ eurRate: RATE }), {
			number: '2026-00000-001',
			issuer: ISSUER,
			issuedBy: 'did'
		});
		expect(invoice.decimals).toBe(6);
		// Were the table to change, the record still says 6.
		expect(moneyUnit(invoice)).toEqual({ code: 'USDC', decimals: 6 });
		expect(moneyUnit({ ...invoice, decimals: 3 })).toEqual({ code: 'USDC', decimals: 3 });
	});

	it('freezes the currency, the rate and the VAT in euros when it is issued', () => {
		const invoice = issue(usdc({ eurRate: RATE }), {
			number: '2026-00000-001',
			issuer: ISSUER,
			issuedBy: 'did'
		});
		expect(invoice.currency).toBe('USDC');
		expect(invoice.eurRate).toEqual(RATE);
		// 0.855 USDC VAT × 0.9123 €/USDC = 0.7800165 € → 78 cents
		expect(invoice.totals).toMatchObject({
			net: '4500000',
			tax: '855000',
			gross: '5355000',
			taxInEuroCents: '78'
		});
	});

	it('takes the currency and the rate into its Storno', () => {
		const invoice = issue(usdc({ eurRate: RATE }), {
			number: '2026-00000-001',
			issuer: ISSUER,
			issuedBy: 'did'
		});
		const storno = cancellationFor(invoice, { issueDate: '2026-09-25' });
		expect(storno.currency).toBe('USDC');
		expect(storno.decimals).toBe(6);
		expect(storno.network).toBe('base');
		expect(storno.eurRate).toEqual(RATE);
		expect(storno.lines[0]).toMatchObject({ quantity: -3, unitPrice: '1500000' });
	});
});

describe('upgradeInvoice', () => {
	/** An issued invoice as the invoice01 chapter of simple-todo wrote it. */
	const legacy = {
		id: 'inv_1',
		state: 'issued',
		number: '2026-00000-001',
		taxMode: 'standard',
		lines: [
			{ description: 'Tagessatz', quantity: 2, unit: 'Tage', unitPriceCents: 50_000, vatRate: 19 }
		],
		totals: {
			netTotalCents: 100_000,
			taxTotalCents: 19_000,
			grossTotalCents: 119_000,
			vatBreakdown: [{ category: 'S', rate: 19, taxableCents: 100_000, taxCents: 19_000 }]
		}
	};

	it('reads an invoice from before currencies as a euro invoice in strings of cents', () => {
		const upgraded = upgradeInvoice(legacy);
		expect(upgraded.currency).toBe('EUR');
		expect(upgraded.decimals).toBe(2);
		expect(upgraded.lines[0]).toEqual({
			description: 'Tagessatz',
			quantity: 2,
			unit: 'Tage',
			unitPrice: '50000',
			vatRate: 19
		});
		expect(upgraded.totals).toEqual({
			net: '100000',
			tax: '19000',
			gross: '119000',
			vatBreakdown: [{ category: 'S', rate: 19, taxable: '100000', tax: '19000' }]
		});
	});

	it('still adds up after the upgrade, and upgrading twice changes nothing', () => {
		expect(totalsDisagree(/** @type {any} */ (legacy))).toBe(false);
		const once = upgradeInvoice(legacy);
		expect(upgradeInvoice(once)).toEqual(once);
	});

	it('leaves the record it was given alone', () => {
		upgradeInvoice(legacy);
		expect(legacy.lines[0]).toHaveProperty('unitPriceCents', 50_000);
	});
});
