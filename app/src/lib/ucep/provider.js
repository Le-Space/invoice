// The invoice extension of UCEP, served by this app (Le-Space/ucep-spec,
// extensions/invoice.md): a paired app — Belege — asks for a self-issued
// receipt (Eigenbeleg), learns its state and fetches its PDF.
//
// Every command but `help` needs a grant, and a grant only reads the
// documents made under it. Arguments are checked by the core
// (@le-space/invoice/eigenbeleg); the numbers come from the Eigenbeleg range,
// never from an invoice circle.

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
import { collectionKeyValue } from './store.js';

/** A PDF goes inline only below this, and only on a direct connection (spec: get-pdf). */
export const INLINE_PDF_LIMIT = 700 * 1024;

export const SCOPES = Object.freeze({
	eigenbeleg: 'invoice:eigenbeleg:create',
	read: 'invoice:document:read'
});

/** @param {(key: string) => string} t */
export function invoiceManifest(t) {
	return {
		id: 'invoice',
		name: t('ucep.manifest.name'),
		version: '0.1.0',
		description: t('ucep.manifest.description'),
		author: 'Le-Space',
		scopes: [
			{ name: SCOPES.eigenbeleg, description: t('ucep.scopes.eigenbeleg') },
			{ name: SCOPES.read, description: t('ucep.scopes.read') }
		]
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
	const digest = await sha256.digest(bytes);
	const hex = Array.from(digest.digest, (b) => b.toString(16).padStart(2, '0')).join('');
	return {
		bytes,
		meta: {
			mime: 'application/pdf',
			cid: CID.create(1, raw.code, digest).toString(),
			size: bytes.byteLength,
			sha256: hex
		}
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
 *   now?: () => Date
 * }} deps
 */
export function invoiceCommands({ store, settings, t, now = () => new Date() }) {
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
	/**
	 * @template T
	 * @param {() => Promise<T>} work
	 * @returns {Promise<T>}
	 */
	function oneAtATime(work) {
		const run = making.then(work, work);
		making = run.then(
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
				return oneAtATime(async () => {
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

		'get-pdf': {
			scope: SCOPES.read,
			description: t('ucep.commands.getPdf'),
			/** @param {any} ctx */
			async handler({ argsJson, grant, limited }) {
				const record = await ownDocument(argsJson, grant);
				if (!isEigenbeleg(record)) throw new UcepError('INVALID_ARGUMENTS', 'documentId: no PDF');
				const { bytes, meta } = await eigenbelegFile(record, t);
				// Inline only on a direct connection and below the limit, so the
				// answer stays within 1 MiB; otherwise the consumer fetches by CID.
				return !limited && bytes.byteLength < INLINE_PDF_LIMIT
					? { ...meta, base64: base64(bytes) }
					: meta;
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
 *   now?: () => Date
 * }} deps
 */
export function createInvoiceProvider({ libp2p, store, settings, t, now }) {
	return createProvider({
		libp2p,
		manifest: invoiceManifest(t),
		commands: invoiceCommands({ store, settings, t, now }),
		store: {
			grants: collectionKeyValue(store.settings, 'ucep/grant/'),
			invitations: collectionKeyValue(store.settings, 'ucep/invitation/')
		}
	});
}
