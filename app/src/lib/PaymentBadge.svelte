<script>
	// How an issued invoice stands: bezahlt (with the day), teilweise bezahlt,
	// offen or überfällig — from the payments a paired app reported.
	import { formatDay } from '@le-space/invoice/document';
	import { t } from '$lib/i18n/index.js';
	import { paymentOf, today } from '$lib/invoices.js';

	/** @type {{ invoice: any }} */
	let { invoice } = $props();

	let payment = $derived(paymentOf(invoice, today()));

	const tone = {
		paid: 'bg-success/15 text-success',
		'partially-paid': 'bg-data-100 text-data-800',
		overdue: 'bg-danger/15 text-danger',
		open: 'border border-border text-text'
	};
	const words = {
		paid: 'invoice.app.list.paid',
		'partially-paid': 'invoice.app.list.partiallyPaid',
		overdue: 'invoice.app.list.overdue',
		open: 'invoice.app.list.open'
	};
</script>

{#if payment}
	<span
		class="ml-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap {tone[
			payment.status
		]}"
		data-testid="payment-status"
		data-status={payment.status}
		>{payment.status === 'paid' && payment.paidOn
			? t('invoice.app.list.paidOn', { date: formatDay(payment.paidOn) })
			: t(words[payment.status])}</span
	>
{/if}
