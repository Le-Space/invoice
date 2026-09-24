import { describe, expect, it } from 'vitest';
import {
	activeCustomers,
	customerFromInvoice,
	customerKey,
	customerProblems,
	emptyCustomer,
	invoiceCustomerFrom,
	isCustomerKey,
	markDeleted,
	matchCustomers
} from './customers.js';
import { emptyDraft, emptyLine, issue } from './records.js';

const directory = [
	emptyCustomer({ id: 'c1', name: 'Stromwerk Test AG', address: 'Probehausen', vatId: 'DE123456789' }),
	emptyCustomer({ id: 'c2', name: 'Acme GmbH', address: 'Berlin', vatId: '' }),
	emptyCustomer({ id: 'c3', name: 'Alt & Weg KG', address: 'Nirgendwo', deletedAt: '2026-01-01' })
];

describe('keys', () => {
	it('keep customers out of the todos and the invoices', () => {
		expect(isCustomerKey(customerKey('cus_1'))).toBe(true);
		expect(isCustomerKey('invoice/inv_1')).toBe(false);
		expect(isCustomerKey('todo_1759_abc')).toBe(false);
	});
});

describe('customerProblems', () => {
	it('wants a name and an address, which is what an invoice needs', () => {
		expect(customerProblems({ name: '', address: '' }).map((p) => p.code)).toEqual([
			'invoice.problem.customerName',
			'invoice.problem.customerAddress'
		]);
		expect(customerProblems({ name: 'Acme GmbH', address: 'Berlin' })).toEqual([]);
	});
});

describe('the directory', () => {
	it('offers what is there, by name, and leaves out what was deleted', () => {
		expect(activeCustomers(directory).map((customer) => customer.name)).toEqual([
			'Acme GmbH',
			'Stromwerk Test AG'
		]);
	});

	it('finds by customer number too, which is how a bookkeeper looks', () => {
		const withNumber = [
			emptyCustomer({ id: 'c9', name: 'Zeta AG', address: 'Ulm', number: '1042' })
		];
		expect(matchCustomers(withNumber, '1042').map((c) => c.id)).toEqual(['c9']);
	});

	it('finds by name, address or VAT id', () => {
		expect(matchCustomers(directory, 'stromwerk').map((c) => c.id)).toEqual(['c1']);
		expect(matchCustomers(directory, 'berlin').map((c) => c.id)).toEqual(['c2']);
		expect(matchCustomers(directory, 'DE1234').map((c) => c.id)).toEqual(['c1']);
		expect(matchCustomers(directory, '   ').map((c) => c.id)).toEqual(['c2', 'c1']);
		// A deleted entry stays out of the picker, whatever is typed.
		expect(matchCustomers(directory, 'Alt')).toEqual([]);
	});
});

describe('between the directory and the invoice', () => {
	it('fills an invoice’s customer block from an entry', () => {
		expect(invoiceCustomerFrom(directory[0])).toEqual({
			number: '',
			name: 'Stromwerk Test AG',
			address: 'Probehausen',
			vatId: 'DE123456789'
		});
	});

	it('makes an entry out of what somebody typed into an invoice', () => {
		const entry = customerFromInvoice({ name: ' Acme GmbH ', address: 'Berlin ', vatId: '' });
		expect(entry.name).toBe('Acme GmbH');
		expect(entry.address).toBe('Berlin');
		expect(entry.deletedAt).toBeNull();
	});

	it('keeps the id when an existing entry is updated', () => {
		const updated = customerFromInvoice({ name: 'Acme AG', address: 'Berlin' }, directory[1]);
		expect(updated.id).toBe('c2');
		expect(updated.name).toBe('Acme AG');
	});

	it('leaves an issued invoice alone when the customer moves', () => {
		// The accounting rule and the log's own nature agree here: the invoice
		// carries a copy, so last year's shows where they were then.
		const invoice = issue(
			{
				...emptyDraft(),
				customer: invoiceCustomerFrom(directory[0]),
				lines: [emptyLine({ description: 'Beratung', quantity: 1, unitPriceCents: 10_000 })]
			},
			{
				number: '2026-1-001',
				issuer: { name: 'Wolkenfabrik UG', address: 'Musterstadt' },
				issuedBy: 'did'
			}
		);
		const moved = { ...directory[0], address: 'Köln' };
		expect(invoice.customer.address).toBe('Probehausen');
		expect(moved.address).toBe('Köln');
	});
});

describe('markDeleted', () => {
	it('hides an entry and says when', () => {
		const gone = markDeleted(directory[1]);
		expect(gone.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(activeCustomers([gone])).toEqual([]);
	});
});
