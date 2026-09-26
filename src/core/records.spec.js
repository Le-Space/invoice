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
	totalsDisagree,
	upgradeInvoice
} from './records.js';

const ISSUER = {
	name: 'Wolkenfabrik Hosting UG (haftungsbeschränkt)',
	address: 'Musterstadt',
	vatId: 'DE000000000'
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
	const RATE = { eurPerUnit: '0.0612', source: 'Kraken', date: '2026-09-24' };
	/** 3 × 1.5 NYM at 19 % */
	const nym = (/** @type {any} */ changes = {}) =>
		readyDraft({
			...emptyDraft({ currency: 'NYM' }),
			customer: { name: 'Stromwerk Test AG', address: 'Probehausen', vatId: '' },
			lines: [emptyLine({ description: 'Mixnode-Betrieb', quantity: 3, unitPrice: '1500000' })],
			...changes
		});

	it('needs a euro rate once it shows VAT, because the VAT is owed in euros', () => {
		expect(codes(draftProblems(nym(), { issuer: ISSUER }))).toEqual(['invoice.problem.eurRate']);
		expect(draftProblems(nym({ eurRate: RATE }), { issuer: ISSUER })).toEqual([]);
		expect(
			codes(draftProblems(nym({ eurRate: { ...RATE, source: ' ' } }), { issuer: ISSUER }))
		).toEqual(['invoice.problem.eurRate']);
		expect(
			codes(draftProblems(nym({ eurRate: { ...RATE, eurPerUnit: '0' } }), { issuer: ISSUER }))
		).toEqual(['invoice.problem.eurRate']);
	});

	it('needs no rate where it shows no VAT', () => {
		const lines = [emptyLine({ description: 'Beratung', unitPrice: '10000', vatRate: 0 })];
		expect(draftProblems(nym({ lines }), { issuer: ISSUER })).toEqual([]);
		expect(draftProblems(nym({ taxMode: 'kleinunternehmer' }), { issuer: ISSUER })).toEqual([]);
	});

	it('refuses a currency it does not know', () => {
		expect(codes(draftProblems(readyDraft({ currency: 'XYZ' }), { issuer: ISSUER }))).toEqual([
			'invoice.problem.currency'
		]);
	});

	it('freezes the currency, the rate and the VAT in euros when it is issued', () => {
		const invoice = issue(nym({ eurRate: RATE }), {
			number: '2026-00000-001',
			issuer: ISSUER,
			issuedBy: 'did'
		});
		expect(invoice.currency).toBe('NYM');
		expect(invoice.eurRate).toEqual(RATE);
		// 0.855 NYM VAT × 0.0612 €/NYM = 0.052326 € → 5 cents
		expect(invoice.totals).toMatchObject({
			net: '4500000',
			tax: '855000',
			gross: '5355000',
			taxInEuroCents: '5'
		});
	});

	it('takes the currency and the rate into its Storno', () => {
		const invoice = issue(nym({ eurRate: RATE }), {
			number: '2026-00000-001',
			issuer: ISSUER,
			issuedBy: 'did'
		});
		const storno = cancellationFor(invoice, { issueDate: '2026-09-25' });
		expect(storno.currency).toBe('NYM');
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
