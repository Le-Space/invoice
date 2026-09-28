// The invoice extension of UCEP, served by this app (Le-Space/ucep-spec,
// extensions/invoice.md, 0.2.0): a paired app — Belege — asks for a
// self-issued receipt (Eigenbeleg), learns its state and fetches its PDF; and
// it reads the issued invoices and reports which of them were paid.
//
// Every command but `help` needs a grant. `invoice:document:read` only reads
// the documents made under the same grant; `invoice:issued:read` reads every
// issued invoice and nothing else (no drafts, no Eigenbelege). Arguments are
// checked by the core (@le-space/invoice/eigenbeleg, /payments); the numbers
// come from the Eigenbeleg range, never from an invoice circle.

import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 } from 'multiformats/hashes/sha2';
import { UcepError, createProvider } from '@le-space/ucep';
import {
	createEigenbeleg,
	eigenbelegProblems,
	isEigenbeleg,
	nextEigenbelegNumber
} from '@le-space/invoice/eigenbeleg';
import { eigenbelegLabels, eigenbelegPdfBytes } from '@le-space/invoice/eigenbeleg-pdf';
import {
	foldCancellations,
	invoiceTotals,
	moneyUnit,
	upgradeInvoice
} from '@le-space/invoice/records';
import { documentLabels } from '@le-space/invoice/labels';
import { invoicePdfBytes } from '@le-space/invoice/pdf';
import {
	applyPayment,
	decimalToUnits,
	dueOn,
	isDay,
	paidUnits,
	paymentState,
	unitsToDecimal
} from '@le-space/invoice/payments';
import { updatePayments } from '../invoices.js';
import { collectionKeyValue } from './store.js';
import { SCOPES, SCOPE_TEXT } from './scopes.js';

/** A PDF goes inline only below this, and only on a direct connection (spec: get-pdf). */
export const INLINE_PDF_LIMIT = 700 * 1024;

/** `list-issued` answers at most this many invoices at once (spec), 100 unless asked. */
export const LIST_LIMIT = 200;
const LIST_DEFAULT = 100;

/**
 * What a `list-issued` answer may weigh: below the relayed limit of 64 KiB, or
 * of 1 MiB on a direct connection, with room for the envelope. A page that
 * would weigh more is cut short and says `next`.
 */
const LIST_BYTES = { limited: 60 * 1024, direct: 1000 * 1024 };

export { SCOPES, SCOPE_TEXT };

/** @param {(key: string) => string} t */
export function invoiceManifest(t) {
	return {
		id: 'invoice',
		name: t('ucep.manifest.name'),
		version: '0.2.0',
		description: t('ucep.manifest.description'),
		author: 'Le-Space',
		scopes: Object.entries(SCOPE_TEXT).map(([name, key]) => ({ name, description: t(key) }))
	};
}

/**
 * The PDF's bytes and what `create-eigenbeleg`, `status` and `get-pdf` say
 * about it.
 *
 * @param {any} record
 * @param {(key: string) => string} t
 */
export async function eigenbelegFile(record, t) {
	const bytes = await eigenbelegPdfBytes(record, eigenbelegLabels(t));
	return { bytes, meta: await fileMeta(bytes) };
}

/**
 * The PDF of an issued invoice, the same bytes the app downloads: drawn from
 * the record as it was issued, dated with the moment it was issued.
 *
 * @param {any} record
 * @param {(key: string) => string} t
 */
export async function invoiceFile(record, t) {
	const bytes = await invoicePdfBytes(
		upgradeInvoice(record),
		documentLabels((key) => t(key))
	);
	return { bytes, meta: await fileMeta(bytes) };
}

/** @param {Uint8Array} bytes */
async function fileMeta(bytes) {
	const digest = await sha256.digest(bytes);
	const hex = Array.from(digest.digest, (b) => b.toString(16).padStart(2, '0')).join('');
	return {
		mime: 'application/pdf',
		cid: CID.create(1, raw.code, digest).toString(),
		size: bytes.byteLength,
		sha256: hex
	};
}

/** @param {Uint8Array} bytes */
function base64(bytes) {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}

/**
 * The commands, on the app's store.
 *
 * @param {{
 *   store: { invoices: import('../store/repository.js').Collection },
 *   settings: () => any,
 *   t: (key: string) => string,
 *   now?: () => Date,
 *   grants?: { values: () => Promise<any[]>, set: (key: string, value: any) => Promise<void> }
 * }} deps `grants` is the provider's own grant store, for the one command
 *   (`get-pdf`) that two scopes open
 */
export function invoiceCommands({ store, settings, t, now = () => new Date(), grants }) {
	/**
	 * The document `documentId` names, if it was made under this grant. Any
	 * other — unknown, or another grant's — is the same INVALID_ARGUMENTS, so
	 * nobody learns that a document exists.
	 *
	 * @param {any} argsJson
	 * @param {any} grant
	 */
	async function ownDocument(argsJson, grant) {
		const id = typeof argsJson?.documentId === 'string' ? argsJson.documentId : '';
		const record = id ? await store.invoices.get(id) : null;
		if (!record || record.deleted || record.grantId !== grant?.grantId) {
			throw new UcepError('INVALID_ARGUMENTS', 'documentId: no such document');
		}
		return record;
	}

	/** Eigenbelege are made one after another, so no two get the same number. */
	let making = Promise.resolve();
	/** @template T @param {() => Promise<T>} work @returns {Promise<T>} */
	function oneEigenbelegAtATime(work) {
		const run = making.then(work, work);
		making = run.then(
			() => {},
			() => {}
		);
		return run;
	}

	/**
	 * Every issued invoice — a Storno too, which is an invoice of its own —
	 * upgraded, with `cancelledBy` folded in. Never a draft, never an
	 * Eigenbeleg, never a deleted record.
	 */
	async function issuedInvoices() {
		const all = await store.invoices.list();
		return foldCancellations(
			all
				.filter(
					(r) =>
						!r.deleted && !isEigenbeleg(r) && r.state === 'issued' && typeof r.number === 'string'
				)
				.map((r) => /** @type {any} */ (upgradeInvoice(r)))
		);
	}

	/**
	 * The issued invoice `documentId` names, or the same INVALID_ARGUMENTS for
	 * anything else.
	 *
	 * @param {any} argsJson
	 */
	async function issuedInvoice(argsJson) {
		const id = typeof argsJson?.documentId === 'string' ? argsJson.documentId : '';
		const found = id ? (await issuedInvoices()).find((invoice) => invoice.id === id) : null;
		if (!found) throw new UcepError('INVALID_ARGUMENTS', 'documentId: no such document');
		return found;
	}

	/**
	 * The grant of the calling peer, checked the way @le-space/ucep checks a
	 * command's one scope — for `get-pdf`, which either of two scopes opens.
	 *
	 * @param {string} peerId
	 * @param {string[]} anyOf
	 */
	async function grantFor(peerId, anyOf) {
		const grant = (await grants?.values())?.find(
			(g) => g?.extensionId === 'invoice' && g.consumerPeerId === peerId
		);
		if (!grant) throw new UcepError('PAIRING_REQUIRED');
		if (grant.expiresAt && grant.expiresAt < now().getTime()) {
			throw new UcepError('GRANT_EXPIRED');
		}
		if (!anyOf.some((scope) => grant.scopes?.includes(scope))) {
			throw new UcepError('SCOPE_MISSING');
		}
		await grants?.set(grant.grantId, { ...grant, lastUsedAt: now().getTime() });
		return grant;
	}

	/** @param {any} invoice upgraded */
	function totalUnits(invoice) {
		return BigInt(invoiceTotals(invoice).due);
	}

	/** @param {bigint | string} units @param {{ code: string, decimals: number }} unit */
	const money = (units, unit) => ({
		value: unitsToDecimal(units, unit.decimals),
		currency: unit.code
	});

	/** @param {any} invoice upgraded, with `cancelledBy` folded in */
	function listed(invoice) {
		const unit = moneyUnit(invoice);
		const total = totalUnits(invoice);
		const payments = Array.isArray(invoice.payments) ? invoice.payments : [];
		const due = total > 0n ? dueOn(invoice) : '';
		return {
			documentId: invoice.id,
			number: invoice.number,
			state: invoice.cancelledBy ? 'cancelled' : 'issued',
			issuedOn: invoice.issueDate,
			...(due ? { dueOn: due } : {}),
			customer: { name: invoice.customer?.name ?? '' },
			total: money(total, unit),
			paid: money(paidUnits(payments), unit),
			payments: payments.map((/** @type {any} */ p) => ({
				paidOn: p.paidOn,
				amount: money(p.units, unit),
				reference: { system: p.reference.system, id: p.reference.id }
			}))
		};
	}

	/** Where an invoice sorts in `list-issued`, and what its cursor says. @param {any} invoice */
	const sortKey = (invoice) => `${invoice.issueDate}_${invoice.id}`;
	const CURSOR = /^\d{4}-\d{2}-\d{2}_[0-9A-Za-z_-]{1,64}$/;

	// One `record-payment` at a time: each reads the payments, changes them and
	// writes them back, and two at once would lose one.
	let recording = Promise.resolve();
	/** @template T @param {() => Promise<T>} work @returns {Promise<T>} */
	function oneAtATime(work) {
		const run = recording.then(work, work);
		recording = run.then(
			() => {},
			() => {}
		);
		return run;
	}

	/** What `create-eigenbeleg` answers about a stored Eigenbeleg. @param {any} record */
	async function made(record) {
		const { meta } = await eigenbelegFile(record, t);
		return { documentId: record.id, number: record.number, state: 'created', file: meta };
	}

	/** @param {string} field */
	const invalid = (field, why = 'invalid') =>
		new UcepError('INVALID_ARGUMENTS', `${field}: ${why}`);

	return {
		help: {
			description: t('ucep.commands.help'),
			handler: () => ({
				commands: [
					{ name: 'help', syntax: 'help', description: t('ucep.commands.help'), scope: '' },
					{
						name: 'create-eigenbeleg',
						syntax: 'create-eigenbeleg {argsJson}',
						description: t('ucep.commands.createEigenbeleg'),
						scope: SCOPES.eigenbeleg
					},
					{
						name: 'status',
						syntax: 'status {"documentId"}',
						description: t('ucep.commands.status'),
						scope: SCOPES.read
					},
					{
						name: 'get-pdf',
						syntax: 'get-pdf {"documentId"}',
						description: t('ucep.commands.getPdf'),
						scope: SCOPES.read
					},
					{
						name: 'list-issued',
						syntax: 'list-issued {"since"?, "cursor"?, "limit"?}',
						description: t('ucep.commands.listIssued'),
						scope: SCOPES.issuedRead
					},
					{
						name: 'record-payment',
						syntax: 'record-payment {"documentId", "paidOn", "amount", "reference"}',
						description: t('ucep.commands.recordPayment'),
						scope: SCOPES.paymentRecord
					}
				]
			})
		},

		'create-eigenbeleg': {
			scope: SCOPES.eigenbeleg,
			idempotent: true,
			description: t('ucep.commands.createEigenbeleg'),
			/** @param {any} ctx */
			async handler({ argsJson, grant, peerId, requestId }) {
				const problems = eigenbelegProblems(argsJson);
				if (problems.length > 0) {
					throw new UcepError('INVALID_ARGUMENTS', `${problems[0].field}: ${problems[0].code}`);
				}
				const issuer = settings()?.issuer;
				if (!issuer?.name?.trim() || !issuer?.address?.trim()) {
					// The app's human has not said who issues: nothing to put on the page.
					throw new UcepError('UNAVAILABLE', 'The invoicing app has no issuer yet.');
				}
				return oneEigenbelegAtATime(async () => {
					const all = await store.invoices.list({ includeDeleted: true });
					// Asked before under this grant (a retry, also after a reload): that one.
					const earlier = all.find(
						(r) =>
							isEigenbeleg(r) &&
							!r.deleted &&
							r.grantId === grant?.grantId &&
							r.requestId === requestId
					);
					if (earlier) return made(earlier);
					const at = now();
					const number = nextEigenbelegNumber(
						all.filter(isEigenbeleg).map((record) => record.number),
						String(at.getFullYear())
					);
					const record = createEigenbeleg(argsJson, {
						number,
						issuer,
						requestedBy: { label: grant?.label ?? '', did: grant?.did || null, peerId },
						createdAt: at.toISOString()
					});
					return made(await store.invoices.put({ ...record, grantId: grant?.grantId, requestId }));
				});
			}
		},

		status: {
			scope: SCOPES.read,
			description: t('ucep.commands.status'),
			/** @param {any} ctx */
			async handler({ argsJson, grant }) {
				const record = await ownDocument(argsJson, grant);
				const eigenbeleg = isEigenbeleg(record);
				return {
					documentId: record.id,
					kind: eigenbeleg ? 'eigenbeleg' : 'invoice',
					state: record.state,
					...(record.number ? { number: record.number } : {}),
					...(eigenbeleg ? { file: (await eigenbelegFile(record, t)).meta } : {})
				};
			}
		},

		// Two scopes open this one: `invoice:document:read` for what the grant
		// made, `invoice:issued:read` for every issued invoice. @le-space/ucep
		// checks one scope per command, so the grant is checked here.
		'get-pdf': {
			description: t('ucep.commands.getPdf'),
			/** @param {any} ctx */
			async handler({ argsJson, peerId, limited }) {
				const grant = await grantFor(peerId, [SCOPES.read, SCOPES.issuedRead]);
				const id = typeof argsJson?.documentId === 'string' ? argsJson.documentId : '';
				let file = null;
				if (grant.scopes.includes(SCOPES.read)) {
					const record = id ? await store.invoices.get(id) : null;
					if (record && !record.deleted && record.grantId === grant.grantId) {
						if (!isEigenbeleg(record)) {
							throw new UcepError('INVALID_ARGUMENTS', 'documentId: no PDF');
						}
						file = await eigenbelegFile(record, t);
					}
				}
				if (!file && grant.scopes.includes(SCOPES.issuedRead)) {
					file = await invoiceFile(await issuedInvoice(argsJson), t);
				}
				if (!file) throw new UcepError('INVALID_ARGUMENTS', 'documentId: no such document');
				const { bytes, meta } = file;
				// Inline only on a direct connection and below the limit, so the
				// answer stays within 1 MiB; otherwise the consumer fetches by CID.
				return !limited && bytes.byteLength < INLINE_PDF_LIMIT
					? { ...meta, base64: base64(bytes) }
					: meta;
			}
		},

		'list-issued': {
			scope: SCOPES.issuedRead,
			description: t('ucep.commands.listIssued'),
			/** @param {any} ctx */
			async handler({ argsJson, limited }) {
				const { since, cursor, limit = LIST_DEFAULT } = argsJson ?? {};
				if (since !== undefined && since !== null && !isDay(since)) throw invalid('since');
				if (
					cursor !== undefined &&
					cursor !== null &&
					!(typeof cursor === 'string' && CURSOR.test(cursor))
				) {
					throw invalid('cursor');
				}
				if (!Number.isInteger(limit) || limit < 1 || limit > LIST_LIMIT) throw invalid('limit');

				const all = (await issuedInvoices())
					.filter((invoice) => !since || invoice.issueDate >= since)
					.filter((invoice) => !cursor || sortKey(invoice) > cursor)
					.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
				const page = all.slice(0, limit);
				const invoices = page.map(listed);
				// Cut short rather than fail: the consumer asks again from `next`.
				const budget = limited ? LIST_BYTES.limited : LIST_BYTES.direct;
				const encoder = new TextEncoder();
				while (
					invoices.length > 1 &&
					encoder.encode(JSON.stringify({ invoices, next: 'x'.repeat(64) })).length > budget
				) {
					invoices.pop();
				}
				const more = all.length > invoices.length;
				return {
					invoices,
					next: more && invoices.length > 0 ? sortKey(page[invoices.length - 1]) : null
				};
			}
		},

		'record-payment': {
			scope: SCOPES.paymentRecord,
			idempotent: true,
			description: t('ucep.commands.recordPayment'),
			/** @param {any} ctx */
			async handler({ argsJson, grant }) {
				return oneAtATime(async () => {
					const invoice = await issuedInvoice(argsJson);
					const total = totalUnits(invoice);
					// A cancelled invoice takes no payment, and neither does a Storno:
					// both are the same answer as an unknown id.
					if (invoice.cancelledBy || invoice.cancels || total <= 0n) {
						throw new UcepError('INVALID_ARGUMENTS', 'documentId: no such document');
					}
					const unit = moneyUnit(invoice);
					const { paidOn, amount, reference } = argsJson ?? {};
					const system = typeof reference?.system === 'string' ? reference.system.trim() : '';
					const refId = typeof reference?.id === 'string' ? reference.id.trim() : '';
					if (!system || !refId || system.length > 64 || refId.length > 128) {
						throw invalid('reference');
					}
					if (paidOn !== null && !isDay(paidOn)) throw invalid('paidOn');

					/** @type {string | null} */
					let units = null;
					if (paidOn !== null) {
						if (amount?.currency !== unit.code)
							throw invalid('amount.currency', 'not the invoice currency');
						units = decimalToUnits(amount?.value, unit.decimals);
						if (units === null || BigInt(units) <= 0n) throw invalid('amount.value');
					}

					const stored = await updatePayments(store, invoice.id, (payments) =>
						applyPayment(payments, {
							paidOn,
							units: units ?? '0',
							reference: { system, id: refId },
							recordedAt: now().toISOString(),
							recordedBy: {
								label: grant?.label ?? '',
								...(grant?.did ? { did: grant.did } : {})
							}
						})
					);
					const paid = paidUnits(stored.payments);
					const open = total > paid ? total - paid : 0n;
					return {
						documentId: invoice.id,
						paid: money(paid, unit),
						open: money(open, unit),
						state: paymentState(total, paid)
					};
				});
			}
		}
	};
}

/**
 * The provider, on a started libp2p node and the app's store.
 *
 * @param {{
 *   libp2p: any,
 *   store: { invoices: import('../store/repository.js').Collection, settings: import('../store/repository.js').Collection },
 *   settings: () => any,
 *   t: (key: string) => string,
 *   now?: () => Date,
 *   confirmInvitations?: boolean
 * }} deps
 */
export function createInvoiceProvider({
	libp2p,
	store,
	settings,
	t,
	now,
	confirmInvitations = true
}) {
	const grants = collectionKeyValue(store.settings, 'ucep/grant/');
	return createProvider({
		libp2p,
		// A link or QR code can be passed on further than meant: whoever uses it
		// waits until this app's human has compared the six digits and said yes.
		confirmInvitations,
		manifest: invoiceManifest(t),
		commands: invoiceCommands({ store, settings, t, now, grants }),
		store: {
			grants,
			invitations: collectionKeyValue(store.settings, 'ucep/invitation/')
		}
	});
}
