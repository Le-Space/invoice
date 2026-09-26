/**
 * The Eigenbeleg as a PDF: one A4 page with the issuer, the number, what was
 * paid and why there is no receipt from the other side, the crypto details
 * where there are any, who asked for it, and a line to sign.
 *
 * Drawn with the same embedded font as the invoice (pdf.js), so a name or a
 * hash prints as it is.
 */

import { formatDay } from './document.js';
import { formatMoney } from './money.js';
import { embedFonts, encodable, wrap } from './pdf.js';

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = { left: 56, right: 56, top: 56 };
const LABEL_WIDTH = 150;

/** The words the Eigenbeleg needs, all under `invoice.eigenbeleg.doc`. */
export const EIGENBELEG_LABEL_KEYS = [
	'title',
	'created',
	'date',
	'direction',
	'outgoing',
	'incoming',
	'amount',
	'counterparty',
	'description',
	'reason',
	'chain',
	'quantity',
	'rate',
	'transaction',
	'explorer',
	'reference',
	'requestedBy',
	'note',
	'signature'
];

/**
 * @param {(key: string) => string} translate
 * @returns {Record<string, string>}
 */
export function eigenbelegLabels(translate) {
	/** @type {Record<string, string>} */
	const labels = {};
	for (const key of EIGENBELEG_LABEL_KEYS) labels[key] = translate(`invoice.eigenbeleg.doc.${key}`);
	return labels;
}

/**
 * The label/value rows, in the order they are printed; a row nobody filled in
 * is left out.
 *
 * @param {any} record from `createEigenbeleg`
 * @param {Record<string, string>} labels
 * @param {{ locale?: string }} [options]
 * @returns {[string, string][]}
 */
export function eigenbelegRows(record, labels, { locale = 'de-DE' } = {}) {
	const c = record.crypto;
	const counterparty = record.counterparty
		? [record.counterparty.name, record.counterparty.address].filter(Boolean).join(', ')
		: '';
	const requested = [record.requestedBy?.label, record.requestedBy?.did]
		.filter(Boolean)
		.join(' · ');
	/** @type {[string, string][]} */
	const rows = [
		[labels.date, formatDay(record.date, locale)],
		[labels.direction, record.direction === 'incoming' ? labels.incoming : labels.outgoing],
		[
			labels.amount,
			formatMoney(record.amount.units, {
				code: record.amount.currency,
				decimals: record.amount.decimals
			})
		],
		[labels.counterparty, counterparty],
		[labels.description, record.description],
		[labels.reason, record.reason],
		...(c
			? /** @type {[string, string][]} */ ([
					[labels.chain, c.asset ? `${c.chain} (${c.asset})` : c.chain],
					[labels.quantity, `${c.quantity.replace('.', ',')} ${c.symbol}`],
					[
						labels.rate,
						c.valuation
							? `${c.valuation.rate.replace('.', ',')} ${c.valuation.rateCurrency}/${c.symbol} (${c.valuation.source}, ${c.valuation.at})`
							: ''
					],
					[labels.transaction, c.txRef ?? ''],
					[labels.explorer, c.explorerUrl ?? '']
				])
			: []),
		[
			labels.reference,
			record.reference ? `${record.reference.system}: ${record.reference.id}` : ''
		],
		[labels.requestedBy, requested]
	];
	return rows.filter(([, value]) => String(value ?? '').trim() !== '');
}

/**
 * @param {any} record from `createEigenbeleg`
 * @param {Record<string, string>} labels from `eigenbelegLabels`
 * @param {{ locale?: string }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function eigenbelegPdfBytes(record, labels, { locale = 'de-DE' } = {}) {
	const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
	const pdf = await PDFDocument.create();
	pdf.setTitle(`${labels.title} ${record.number}`);
	pdf.setProducer('Le-Space invoice');
	// The document's own moment, not the clock's: the same Eigenbeleg is the
	// same bytes every time it is drawn, so its SHA-256 and CID (get-pdf) hold.
	const made = new Date(record.createdAt);
	pdf.setCreationDate(made);
	pdf.setModificationDate(made);
	const { regular, bold, embedded } = await embedFonts(pdf, StandardFonts);
	const ink = rgb(0.09, 0.09, 0.11);
	const faint = rgb(0.45, 0.45, 0.48);
	const page = pdf.addPage([A4.width, A4.height]);
	let y = A4.height - MARGIN.top;
	const right = A4.width - MARGIN.right;

	/** @param {string} value @param {{ x?: number, size?: number, font?: any, color?: any, alignRight?: number }} [o] */
	const write = (
		value,
		{ x = MARGIN.left, size = 10, font = regular, color = ink, alignRight } = {}
	) => {
		const t = encodable(value, embedded);
		const left = alignRight !== undefined ? alignRight - font.widthOfTextAtSize(t, size) : x;
		page.drawText(t, { x: left, y, size, font, color });
	};

	// The issuer, top right.
	const issuer = record.issuer ?? {};
	for (const [index, line] of [issuer.name, ...String(issuer.address ?? '').split(/\r?\n/)]
		.filter(Boolean)
		.entries()) {
		write(line, { alignRight: right, size: 9, font: index === 0 ? bold : regular });
		y -= 12;
	}

	y -= 30;
	write(`${labels.title}  ${record.number}`, { size: 16, font: bold });
	y -= 16;
	write(`${labels.created} ${formatDay(String(record.createdAt).slice(0, 10), locale)}`, {
		size: 9,
		color: faint
	});
	y -= 28;

	const valueWidth = right - MARGIN.left - LABEL_WIDTH;
	for (const [label, value] of eigenbelegRows(record, labels, { locale })) {
		write(label, { size: 9, font: bold, color: faint });
		const lines = wrap(value, regular, 10, valueWidth);
		lines.forEach((line, index) => {
			if (index > 0) y -= 13;
			write(line, { x: MARGIN.left + LABEL_WIDTH });
		});
		y -= 20;
	}

	y -= 10;
	for (const line of wrap(labels.note, regular, 9, right - MARGIN.left)) {
		write(line, { size: 9, color: faint });
		y -= 12;
	}

	// A line to sign: an Eigenbeleg is signed off by the one who made it.
	y -= 50;
	page.drawLine({
		start: { x: MARGIN.left, y },
		end: { x: MARGIN.left + 220, y },
		thickness: 0.6,
		color: faint
	});
	y -= 12;
	write(labels.signature, { size: 8, color: faint });

	return pdf.save();
}

/** @param {any} record */
export function eigenbelegFileName(record) {
	return `Eigenbeleg-${String(record?.number ?? '').replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`;
}
