/**
 * The invoice record, and the one act that freezes it.
 *
 * An invoice has two lives. As a *draft* it is an ordinary entry that may be
 * rewritten as often as anyone likes. *Issuing* is the act that gives it its
 * number, copies in everything it must still show years later, and ends the
 * rewriting: §14 Abs. 4 UStG lists what has to be on the document, and
 * §31 Abs. 5 UStDV says a wrong invoice is corrected — not edited. Whoever
 * states VAT owes it under §14c UStG until a correction exists.
 *
 * That matches the log this runs on, which is the reason the shape is worth
 * getting right here rather than in the user interface: a replicated
 * append-only log cannot take an entry back, so an issued invoice is never
 * rewritten. A *Storno* is its own invoice, with the amounts negated and a
 * reference to the one it cancels, and `foldCancellations` puts the two back
 * together for the reader.
 *
 * What is copied rather than referenced — the issuer's and the customer's
 * address, and the totals — is copied on purpose. When a customer moves, last
 * year's invoice must still show where they were when it was issued.
 */

import { INVOICE_CURRENCIES, VAT_CURRENCY, currencyOf } from './currency.js';
import { computeTotals, inEuroCents, parseRate, toUnits } from './money.js';
import { CURRENCY_NETWORKS, defaultNetwork, paysOn } from './networks.js';
import { PAY_TO, cryptoShown, payToAddress } from './payment-code.js';

/**
 * Integer division rounding half away from zero, for rescaling a price.
 *
 * @param {bigint} numerator
 * @param {bigint} divisor positive
 */
function divRound(numerator, divisor) {
	const negative = numerator < 0n;
	const abs = negative ? -numerator : numerator;
	const quotient = abs / divisor;
	const rounded = (abs - quotient * divisor) * 2n >= divisor ? quotient + 1n : quotient;
	return negative ? -rounded : rounded;
}

/**
 * What the amounts of this invoice are in: its currency and the decimals it
 * was written with. Both are on the record, so it reads the same however the
 * table in `currency.js` changes later.
 *
 * @param {{ currency?: string, decimals?: number }} invoice
 * @returns {{ code: string, decimals: number }}
 */
export function moneyUnit(invoice) {
	const code = invoice.currency ?? VAT_CURRENCY;
	return {
		code,
		decimals: invoice.decimals ?? /** @type {number} */ (currencyOf(code)?.decimals)
	};
}

/** Every invoice entry is keyed with this, so it is not read as a todo. */
export const INVOICE_PREFIX = 'invoice/';

/** @typedef {'standard' | 'kleinunternehmer' | 'reverse-charge'} TaxMode */
/** @typedef {{ name: string, address: string, vatId?: string, email?: string, iban?: string }} Party */
/**
 * Who the invoice is for. The customer number is theirs to keep or not: a
 * business migrating from another program brings one, a one-off customer has
 * none, and the document prints it only where it is there.
 *
 * @typedef {{ name: string, address: string, vatId?: string, number?: string }} Recipient
 */
/**
 * A line as it is charged, and as it is explained.
 *
 * `description` is what the line is; `subtitle` is the one-line context under
 * it ("Doichain Core 31.1 · Aufwand 9,5 Std."), and `details` are the bullets
 * that say what was actually done. Both are optional and neither affects a
 * figure — they exist because an invoice a customer can check is an invoice
 * that gets paid.
 *
 * @typedef {{
 *   description: string,
 *   subtitle?: string,
 *   details?: string[],
 *   quantity: number,
 *   unit: string,
 *   unitPrice: string,
 *   vatRate: number,
 *   source?: import('./crypto-lines.js').LineSource,
 *   crypto?: { asset: string, quantity: string, rate: string, rateSource: string, rateAt: string, hash?: string }
 * }} InvoiceLine
 *
 * A line of crypto keeps what it was made of in `source` (crypto-lines.js):
 * the asset, the quantity, the rate. One entered by hand also keeps what was
 * typed in `crypto`, so the editor shows it again.
 *
 * `unitPrice` is net, in the smallest unit of the invoice's currency, as an
 * integer in a string (`money.js`).
 */
/**
 * What an invoice in another currency than euros states for its VAT: how many
 * euros one whole unit was worth, by whose account, on which day. §16 Abs. 6
 * UStG names the monthly rates of the Federal Ministry of Finance; a daily rate
 * from a bank or an exchange needs the tax office's consent.
 *
 * @typedef {{ eurPerUnit: string, source: string, date: string }} EurRate
 */
/** @typedef {{ code: string, field: string, line?: number }} Problem */

/** @param {string} key */
export function isInvoiceKey(key) {
	return typeof key === 'string' && key.startsWith(INVOICE_PREFIX);
}

/** @param {string} id */
export function invoiceKey(id) {
	return `${INVOICE_PREFIX}${id}`;
}

/** A key nobody else writes, in the shape the todos already use. */
export function newInvoiceId() {
	return `inv_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** @param {Date} [date] */
function isoDay(date = new Date()) {
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 10);
}

/**
 * A line with nothing in it yet.
 *
 * @param {Partial<InvoiceLine>} [values]
 * @returns {InvoiceLine}
 */
export function emptyLine(values = {}) {
	return {
		description: '',
		subtitle: '',
		details: [],
		quantity: 1,
		unit: 'Stück',
		unitPrice: '0',
		vatRate: 19,
		...values
	};
}

/**
 * A draft, ready to be filled in.
 *
 * @param {{ taxMode?: TaxMode, currency?: string, customer?: Partial<Recipient>, issueDate?: string }} [values]
 */
export function emptyDraft({ taxMode = 'standard', currency = 'EUR', customer, issueDate } = {}) {
	const day = issueDate ?? isoDay();
	return {
		id: newInvoiceId(),
		state: /** @type {'draft'} */ ('draft'),
		taxMode,
		/** What every amount on this invoice is in (`currency.js`). */
		currency,
		/**
		 * Where the decimal point goes in every amount of this invoice, copied
		 * from `currency.js` now rather than looked up when it is read.
		 */
		decimals: currencyOf(currency)?.decimals ?? 2,
		/** The chain a crypto invoice is paid on (`networks.js`); null for fiat. */
		network: defaultNetwork(currency),
		/** Needed once the invoice is not in euros and shows VAT. */
		eurRate: /** @type {EurRate | null} */ (null),
		customer: /** @type {Recipient} */ ({
			number: '',
			name: '',
			address: '',
			vatId: '',
			...customer
		}),
		lines: [emptyLine()],
		issueDate: day,
		/** §14 Abs. 4 Nr. 6 UStG: the invoice says when it was delivered, not only when it was written. */
		deliveryDate: day,
		paymentTermsDays: 14,
		notes: '',
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	};
}

/**
 * The note an invoice must carry because of its tax mode, or null.
 *
 * @param {TaxMode} taxMode
 */
export function requiredNoteCode(taxMode) {
	if (taxMode === 'kleinunternehmer') return 'invoice.note.kleinunternehmer';
	if (taxMode === 'reverse-charge') return 'invoice.note.reverseCharge';
	return null;
}

/**
 * What still stands in the way of issuing this draft.
 *
 * Codes, not sentences: the texts live in the catalogues, where a missing
 * translation is caught by `catalogue.spec.js`.
 *
 * @param {ReturnType<typeof emptyDraft>} draft
 * @param {{ issuer?: Partial<Party> & { crypto?: Record<string, string> } }} [context]
 * @returns {Problem[]}
 */
export function draftProblems(draft, { issuer } = {}) {
	draft = upgradeInvoice(draft);
	/** @type {Problem[]} */
	const problems = [];
	const text = (/** @type {unknown} */ value) => (typeof value === 'string' ? value.trim() : '');

	if (!text(issuer?.name) || !text(issuer?.address)) {
		problems.push({ code: 'invoice.problem.issuerMissing', field: 'issuer' });
	}
	if (!text(draft.customer?.name)) {
		problems.push({ code: 'invoice.problem.customerName', field: 'customer.name' });
	}
	if (!text(draft.customer?.address)) {
		problems.push({ code: 'invoice.problem.customerAddress', field: 'customer.address' });
	}
	// §13b UStG only works towards a business that names its VAT id.
	if (draft.taxMode === 'reverse-charge' && !text(draft.customer?.vatId)) {
		problems.push({ code: 'invoice.problem.customerVatId', field: 'customer.vatId' });
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text(draft.issueDate))) {
		problems.push({ code: 'invoice.problem.issueDate', field: 'issueDate' });
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text(draft.deliveryDate))) {
		problems.push({ code: 'invoice.problem.deliveryDate', field: 'deliveryDate' });
	}

	const lines = Array.isArray(draft.lines) ? draft.lines : [];
	if (lines.length === 0) {
		problems.push({ code: 'invoice.problem.noLines', field: 'lines' });
	}
	lines.forEach((line, index) => {
		// A crypto line entered by hand (`crypto` the typed input) is priced
		// only once asset, quantity and rate make one (`source`).
		if (line?.crypto && !line.source) {
			problems.push({ code: 'invoice.problem.cryptoLine', field: 'crypto', line: index });
		}
		if (!text(line?.description)) {
			problems.push({ code: 'invoice.problem.lineDescription', field: 'description', line: index });
		}
		if (!Number.isFinite(line?.quantity) || line.quantity === 0) {
			problems.push({ code: 'invoice.problem.lineQuantity', field: 'quantity', line: index });
		}
		if (typeof line?.unitPrice !== 'string' || toUnits(line.unitPrice) === null) {
			problems.push({ code: 'invoice.problem.lineUnitPrice', field: 'unitPrice', line: index });
		}
		if (draft.taxMode === 'standard' && ![0, 7, 19].includes(line?.vatRate)) {
			problems.push({ code: 'invoice.problem.lineVatRate', field: 'vatRate', line: index });
		}
	});

	const currency = currencyOf(draft.currency);
	// The record's decimals are what its prices mean, also on a draft stored
	// before the table in currency.js changed; `draftWarnings` says when they
	// differ, and only decimals that are none are refused.
	if (!currency || !Number.isInteger(draft.decimals) || draft.decimals < 0) {
		problems.push({ code: 'invoice.problem.currency', field: 'currency' });
	} else if (
		!INVOICE_CURRENCIES.includes(currency.code) &&
		!(/** @type {{ cancels?: string }} */ (draft).cancels)
	) {
		// Known, so that old invoices in it still read and can be cancelled
		// (a Storno keeps the currency of what it cancels), but no new one.
		problems.push({ code: 'invoice.problem.currencyRetired', field: 'currency' });
	} else if (currency.code !== VAT_CURRENCY && showsVat(draft)) {
		// Art. 230 MwStSystRL, §16 Abs. 6 UStG: the VAT is owed in euros, so an
		// invoice in dollars or NYM has to say what its VAT is in euros — at the
		// rate of the month the service was rendered in, not of the day it is
		// printed.
		if (!validEurRate(draft.eurRate)) {
			problems.push({ code: 'invoice.problem.eurRate', field: 'eurRate' });
		} else if (
			String(draft.eurRate?.date).slice(0, 7) !== String(draft.deliveryDate ?? '').slice(0, 7)
		) {
			problems.push({ code: 'invoice.problem.eurRateMonth', field: 'eurRate' });
		}
	}
	// An invoice in a crypto currency is paid to an address, and one that names
	// none — or one that is not an address on that chain — cannot be paid.
	if (
		currency &&
		Object.hasOwn(PAY_TO, currency.code) &&
		!payToAddress(currency.code, issuer?.crypto)
	) {
		problems.push({ code: 'invoice.problem.payAddress', field: 'issuer.crypto' });
	}
	// USDC on Base is not USDC on Ethereum: a crypto invoice names the network
	// it is paid on, one its currency exists on.
	if (
		currency &&
		Object.hasOwn(CURRENCY_NETWORKS, currency.code) &&
		!paysOn(currency.code, draft.network)
	) {
		problems.push({ code: 'invoice.problem.network', field: 'network' });
	}

	return problems;
}

/**
 * What is worth a second look before issuing, but does not stand in the way.
 *
 * - `invoice.warning.decimals`: the draft was written with other decimals than
 *   its currency has now (currency.js changed since). Its prices still mean
 *   what they meant; issuing freezes the draft's own decimals.
 *
 * @param {ReturnType<typeof emptyDraft>} draft
 * @returns {Problem[]}
 */
export function draftWarnings(draft) {
	draft = upgradeInvoice(draft);
	const current = currencyOf(draft.currency)?.decimals;
	return current !== undefined && draft.decimals !== current
		? [{ code: 'invoice.warning.decimals', field: 'currency' }]
		: [];
}

/**
 * A draft in another currency: the decimals follow the currency, and every
 * price keeps the figure it showed ("1,50" stays "1,50"), rounded half away
 * from zero where the new currency has fewer decimals. This is the one place a
 * draft's currency changes — setting `currency` alone would leave its prices
 * meaning something else by 10ⁿ.
 *
 * @template {ReturnType<typeof emptyDraft>} D
 * @param {D} draft
 * @param {string} code
 * @returns {D}
 */
export function setCurrency(draft, code) {
	const target = currencyOf(code);
	if (!target) throw new Error(`Unknown currency: ${code}`);
	const from = moneyUnit(upgradeInvoice(draft)).decimals;
	const shift = BigInt(target.decimals - from);
	const rescale = (/** @type {unknown} */ price) => {
		const units = toUnits(price);
		if (units === null) return price;
		return (shift >= 0n ? units * 10n ** shift : divRound(units, 10n ** -shift)).toString();
	};
	return {
		...upgradeInvoice(draft),
		currency: target.code,
		decimals: target.decimals,
		network:
			target.code === draft.currency
				? (upgradeInvoice(draft).network ?? null)
				: defaultNetwork(target.code),
		// A rate is for one currency; a new one has to be looked up.
		eurRate: target.code === draft.currency ? (draft.eurRate ?? null) : null,
		lines: (upgradeInvoice(draft).lines ?? []).map((/** @type {InvoiceLine} */ line) => ({
			...line,
			unitPrice: rescale(line.unitPrice)
		}))
	};
}

/**
 * Whether the invoice states VAT at all: only in standard taxation, and only
 * when a line is charged at a rate above zero.
 *
 * @param {{ taxMode?: TaxMode, lines?: { vatRate?: number }[] }} invoice
 */
function showsVat(invoice) {
	return (
		(invoice.taxMode ?? 'standard') === 'standard' &&
		(invoice.lines ?? []).some((line) => Number(line?.vatRate) > 0)
	);
}

/** @param {any} rate */
function validEurRate(rate) {
	return (
		parseRate(rate?.eurPerUnit) !== null &&
		typeof rate?.source === 'string' &&
		rate.source.trim() !== '' &&
		/^\d{4}-\d{2}-\d{2}$/.test(String(rate?.date ?? ''))
	);
}

/**
 * The totals of an invoice, computed — never read back from the record.
 *
 * On an issued invoice the stored copy is a witness: it and this result must
 * agree, and `totalsDisagree` is how a reader finds out that they do not.
 *
 * @param {{ lines: InvoiceLine[], taxMode: TaxMode }} invoice
 */
export function invoiceTotals(invoice) {
	return computeTotals(upgradeInvoice(invoice).lines ?? [], invoice.taxMode ?? 'standard');
}

/**
 * The VAT in euro cents, for an invoice in another currency that shows VAT;
 * null for a euro invoice, one without VAT, or one without a usable rate.
 *
 * @param {{ currency?: string, eurRate?: EurRate | null, taxMode?: TaxMode, lines?: any[] }} invoice
 * @param {{ tax: string }} totals
 * @returns {string | null}
 */
export function vatInEuroCents(invoice, totals) {
	const currency = invoice.currency ?? VAT_CURRENCY;
	if (currency === VAT_CURRENCY || !showsVat(invoice) || !validEurRate(invoice.eurRate)) {
		return null;
	}
	return inEuroCents(
		totals.tax,
		moneyUnit(invoice),
		/** @type {EurRate} */ (invoice.eurRate).eurPerUnit
	);
}

/**
 * An invoice as this module writes it, from one written by the invoice01
 * chapter of simple-todo, which knew only euros: integer cents in numbers
 * (`unitPriceCents`, `netTotalCents` …) become strings of the smallest unit,
 * and the currency is said out loud. An invoice already in the new shape comes
 * back unchanged, so a reader can pass everything it reads through here.
 *
 * @template {Record<string, any>} T
 * @param {T} invoice
 * @returns {T & { currency: string }}
 */
export function upgradeInvoice(invoice) {
	if (!invoice || typeof invoice !== 'object') return invoice;
	const lines = Array.isArray(invoice.lines)
		? invoice.lines.map((/** @type {any} */ line) => {
				if (!line || !('unitPriceCents' in line) || 'unitPrice' in line) return line;
				const { unitPriceCents, ...rest } = line;
				const units = toUnits(unitPriceCents);
				return { ...rest, unitPrice: units === null ? unitPriceCents : units.toString() };
			})
		: invoice.lines;
	/** @type {any} */
	let totals = invoice.totals;
	if (totals && 'grossTotalCents' in totals && !('gross' in totals)) {
		totals = {
			net: String(totals.netTotalCents),
			tax: String(totals.taxTotalCents),
			gross: String(totals.grossTotalCents),
			vatBreakdown: (totals.vatBreakdown ?? []).map((/** @type {any} */ group) => ({
				category: group.category,
				rate: group.rate,
				taxable: String(group.taxableCents),
				tax: String(group.taxCents)
			}))
		};
	}
	return {
		...invoice,
		currency: invoice.currency ?? VAT_CURRENCY,
		// invoice01 knew only euro cents; anything newer carries its own.
		decimals: invoice.decimals ?? (invoice.currency ? currencyOf(invoice.currency)?.decimals : 2),
		// Before invoices named their network, a crypto invoice was paid on the
		// first network of its currency: Ethereum for ETH and USDC.
		network:
			invoice.network === undefined
				? defaultNetwork(invoice.currency ?? VAT_CURRENCY)
				: invoice.network,
		...(lines === undefined ? {} : { lines }),
		...(totals === undefined ? {} : { totals })
	};
}

/**
 * Turn a draft into an issued invoice: the number is assigned, the addresses
 * and totals are frozen, and nothing about it is rewritten afterwards.
 *
 * @param {ReturnType<typeof emptyDraft>} draft
 * @param {{ number: string, issuer: Party, issuedBy: string, issuedAt?: string, template?: string }} act
 */
export function issue(
	draft,
	{ number, issuer, issuedBy, issuedAt = new Date().toISOString(), template = '' }
) {
	draft = upgradeInvoice(draft);
	const problems = draftProblems(draft, { issuer });
	if (problems.length > 0) {
		throw new Error(`This invoice is not ready to be issued: ${problems[0].code}`);
	}
	if (!number || typeof number !== 'string') {
		throw new Error('An issued invoice needs its number.');
	}

	const { net, tax, gross, vatBreakdown } = invoiceTotals(draft);
	const taxInEuroCents = vatInEuroCents(draft, { tax });
	return {
		...draft,
		state: /** @type {'issued'} */ ('issued'),
		number,
		issuedAt,
		issuedBy,
		// Frozen with only the address this invoice is paid to (none in euros).
		issuer: {
			...issuer,
			crypto: cryptoShown(draft.currency, /** @type {any} */ (issuer)?.crypto)
		},
		customer: { ...draft.customer },
		// The wording is frozen with everything else: a template edited next
		// year must not change what last year's invoice said.
		template,
		lines: draft.lines.map((line) => ({ ...line, details: [...(line.details ?? [])] })),
		noteCode: requiredNoteCode(draft.taxMode),
		totals: {
			net,
			tax,
			gross,
			vatBreakdown,
			...(taxInEuroCents === null ? {} : { taxInEuroCents })
		},
		updatedAt: issuedAt
	};
}

/**
 * Whether an issued invoice still adds up to what it says it does.
 *
 * @param {ReturnType<typeof issue>} invoice
 */
export function totalsDisagree(invoice) {
	if (!invoice?.totals) return false;
	const stored = upgradeInvoice(invoice).totals;
	const computed = invoiceTotals(invoice);
	return (
		computed.net !== stored.net || computed.tax !== stored.tax || computed.gross !== stored.gross
	);
}

/**
 * The draft that cancels an issued invoice (§31 Abs. 5 UStDV).
 *
 * Same lines, negated quantities, and a reference to the number it takes back.
 * It is issued like any other invoice and gets the next number of the series —
 * the original is left exactly as it was, because in an append-only log that is
 * the only honest way to correct it.
 *
 * @param {ReturnType<typeof issue>} issued
 * @param {{ issueDate?: string }} [options]
 */
export function cancellationFor(issued, { issueDate = isoDay() } = {}) {
	if (issued?.state !== 'issued' || !issued.number) {
		throw new Error('Only an issued invoice can be cancelled.');
	}

	return {
		...emptyDraft({
			taxMode: issued.taxMode,
			currency: issued.currency ?? VAT_CURRENCY,
			customer: issued.customer,
			issueDate
		}),
		// The Storno takes back the same VAT in euros, so it states the same
		// rate — the one of the invoice it cancels, never today's — and counts
		// in the same decimals.
		decimals: moneyUnit(issued).decimals,
		network: upgradeInvoice(issued).network,
		eurRate: issued.eurRate ?? null,
		deliveryDate: issued.deliveryDate,
		paymentTermsDays: issued.paymentTermsDays,
		cancels: issued.number,
		lines: upgradeInvoice(issued).lines.map((/** @type {InvoiceLine} */ line) => ({
			...line,
			quantity: -line.quantity
		}))
	};
}

/**
 * Mark the invoices that a Storno has taken back.
 *
 * The log carries both entries and says nothing about their relationship; this
 * is where the reader gets it back, the same way delegation actions are folded
 * into the todo they name.
 *
 * @template {{ number?: string, cancels?: string }} T
 * @param {T[]} invoices
 * @returns {(T & { cancelledBy?: string })[]}
 */
export function foldCancellations(invoices) {
	/** @type {Map<string, string>} */
	const cancelled = new Map();
	for (const invoice of invoices) {
		if (invoice.cancels && invoice.number) cancelled.set(invoice.cancels, invoice.number);
	}
	return invoices.map((invoice) =>
		invoice.number && cancelled.has(invoice.number)
			? { ...invoice, cancelledBy: cancelled.get(invoice.number) }
			: invoice
	);
}
