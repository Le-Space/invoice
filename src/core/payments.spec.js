import { describe, expect, it } from 'vitest';
import {
	applyPayment,
	decimalToUnits,
	dueOn,
	isDay,
	paidUnits,
	paymentState,
	paymentStatus,
	unitsToDecimal
} from './payments.js';

const ref = (/** @type {string} */ id) => ({ system: 'belege', id });

describe('payments on an issued invoice', () => {
	it('read and write decimal strings in whole units, never floats', () => {
		expect(decimalToUnits('119.00', 2)).toBe('11900');
		expect(decimalToUnits('119', 2)).toBe('11900');
		expect(decimalToUnits('0.1', 2)).toBe('10');
		expect(decimalToUnits('12.500000', 6)).toBe('12500000');
		for (const bad of ['119.001', '-1.00', '1,00', '1e3', ' 1', '', '.5']) {
			expect(decimalToUnits(bad, 2)).toBeNull();
		}
		expect(decimalToUnits(119, 2)).toBeNull();
		expect(unitsToDecimal('11900', 2)).toBe('119.00');
		expect(unitsToDecimal('5', 2)).toBe('0.05');
		expect(unitsToDecimal(-11900n, 2)).toBe('-119.00');
		expect(unitsToDecimal('14875000', 6)).toBe('14.875000');
		expect(unitsToDecimal('7', 0)).toBe('7');
	});

	it('know a day when they see one', () => {
		expect(isDay('2026-09-12')).toBe(true);
		expect(isDay('2026-02-30')).toBe(false);
		expect(isDay('2026-9-12')).toBe(false);
		expect(isDay(null)).toBe(false);
	});

	it('add, replace and remove a payment by its reference', () => {
		let payments = applyPayment([], { paidOn: '2026-09-12', units: '5000', reference: ref('A') });
		payments = applyPayment(payments, { paidOn: '2026-09-10', units: '2000', reference: ref('B') });
		expect(payments.map((p) => p.reference.id)).toEqual(['B', 'A']);
		expect(paidUnits(payments)).toBe(7000n);

		payments = applyPayment(payments, { paidOn: '2026-09-13', units: '6000', reference: ref('A') });
		expect(payments).toHaveLength(2);
		expect(paidUnits(payments)).toBe(8000n);

		payments = applyPayment(payments, { paidOn: null, reference: ref('B') });
		expect(payments).toEqual([
			{ paidOn: '2026-09-13', units: '6000', reference: { system: 'belege', id: 'A' } }
		]);
		// Another system's reference with the same id is another payment.
		payments = applyPayment(payments, {
			paidOn: '2026-09-14',
			units: '1',
			reference: { system: 'other', id: 'A' }
		});
		expect(payments).toHaveLength(2);
	});

	it('say whether an invoice is open, part paid, paid or overpaid', () => {
		expect(paymentState('11900', '0')).toBe('open');
		expect(paymentState('11900', '5000')).toBe('partially-paid');
		expect(paymentState('11900', '11900')).toBe('paid');
		expect(paymentState('11900', '12000')).toBe('overpaid');
	});

	it('tell the screens paid, part paid, overdue or open', () => {
		const invoice = { issueDate: '2026-09-01', paymentTermsDays: 14, payments: [] };
		expect(dueOn(invoice)).toBe('2026-09-15');
		expect(dueOn({ issueDate: '2026-09-01' })).toBe('');
		expect(paymentStatus(invoice, '11900', '2026-09-15')).toEqual({
			status: 'open',
			paidOn: null
		});
		expect(paymentStatus(invoice, '11900', '2026-09-16').status).toBe('overdue');

		const part = {
			...invoice,
			payments: [{ paidOn: '2026-09-05', units: '5000', reference: ref('A') }]
		};
		expect(paymentStatus(part, '11900', '2026-09-10').status).toBe('partially-paid');
		expect(paymentStatus(part, '11900', '2026-09-20').status).toBe('overdue');

		const paid = {
			...invoice,
			payments: [...part.payments, { paidOn: '2026-09-20', units: '6900', reference: ref('B') }]
		};
		expect(paymentStatus(paid, '11900', '2026-10-01')).toEqual({
			status: 'paid',
			paidOn: '2026-09-20'
		});
	});
});
