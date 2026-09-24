/**
 * The invoice as a file somebody can send.
 *
 * Drawn here rather than printed by the browser: a print dialogue adds its own
 * header, footer and page URL, and what comes out depends on the browser and
 * the person operating it. An invoice is a document that has to look the same
 * every time, carry its own file name and leave the app in one click.
 *
 * `pdf-lib` is loaded only when somebody actually exports, so the page itself
 * never pays for it. `document.js` decides what the invoice says; this file
 * only decides where it sits on the page.
 */

import { documentModel } from './document.js';

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = { left: 56, right: 56, top: 48, bottom: 64 };
const SIZE = { small: 8, body: 10, title: 16 };

/**
 * Where each column sits. Everything that carries a number is right-aligned on
 * its edge so the digits line up; only the position and the description start
 * at a left edge. The gaps are wide enough for "1 Pauschale" beside
 * "1.000,00 EUR", which is where an earlier layout ran the two into each other.
 */
const COLUMN = { position: 56, description: 82, quantity: 370, unitPrice: 430, vat: 470, net: 539 };

/** How wide a description may be before it wraps onto the next line. */
const DESCRIPTION_WIDTH = 225;

/**
 * What Helvetica can put on the page.
 *
 * pdf-lib throws on a character the standard fonts cannot encode, which would
 * turn a pasted em dash or a Polish name into a failed export. Everything
 * outside WinAnsi is folded to something close rather than dropped silently.
 *
 * @param {unknown} value
 */
function encodable(value) {
	return String(value ?? '')
		.replace(/[\u2018\u2019\u201A\u2039\u203A]/g, "'")
		.replace(/[\u201C\u201D\u201E]/g, '"')
		.replace(/[\u2013\u2014]/g, '-')
		.replace(/\u2026/g, '...')
		.replace(/\u00A0/g, ' ')
		.replace(/[^\u0020-\u007E\u00A0-\u00FF\u20AC]/g, '?');
}

/** @param {any} invoice */
export function invoiceFileName(invoice) {
	const number = String(invoice?.number ?? 'Entwurf').replace(/[^A-Za-z0-9._-]/g, '-');
	return `Rechnung-${number}.pdf`;
}

/**
 * The invoice as PDF bytes.
 *
 * @param {any} invoice an issued invoice
 * @param {Record<string, string>} labels
 * @param {{ locale?: string }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function invoicePdfBytes(invoice, labels, { locale = 'de-DE' } = {}) {
	const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
	const model = documentModel(invoice, labels, { locale });

	const pdf = await PDFDocument.create();
	pdf.setTitle(`${labels.title} ${invoice.number ?? ''}`.trim());
	pdf.setProducer('simple-todo invoice01');
	const regular = await pdf.embedFont(StandardFonts.Helvetica);
	const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
	const ink = rgb(0.09, 0.09, 0.11);
	const faint = rgb(0.42, 0.42, 0.46);

	let page = pdf.addPage([A4.width, A4.height]);
	let y = A4.height - MARGIN.top;

	/**
	 * @param {string} text
	 * @param {{ x?: number, size?: number, font?: any, color?: any, alignRight?: number }} [options]
	 */
	const write = (
		text,
		{ x = MARGIN.left, size = SIZE.body, font = regular, color = ink, alignRight } = {}
	) => {
		const value = encodable(text);
		if (value === '') return;
		const left = alignRight === undefined ? x : alignRight - font.widthOfTextAtSize(value, size);
		page.drawText(value, { x: left, y, size, font, color });
	};

	/** A new page when the next block would not fit. */
	const room = (/** @type {number} */ needed) => {
		if (y - needed > MARGIN.bottom) return;
		page = pdf.addPage([A4.width, A4.height]);
		y = A4.height - MARGIN.top;
	};

	// Who is charging, top right.
	for (const line of model.issuer) {
		write(line, { size: SIZE.small, color: faint, alignRight: A4.width - MARGIN.right });
		y -= 11;
	}

	// The address field, where a window envelope expects it.
	y = A4.height - 150;
	// The sender line above the address field: the whole address on one line, as
	// the post expects it, not only its first half.
	if (model.issuer.length > 0) {
		write(model.issuer.slice(0, 3).join(' · '), { size: 6.5, color: faint });
		y -= 14;
	}
	for (const line of model.recipient) {
		write(line);
		y -= 13;
	}

	// Title and the dates beside it.
	y = A4.height - 268;
	write(model.title, { size: SIZE.title, font: bold });
	let metaY = y + 4;
	for (const [label, value] of model.meta) {
		page.drawText(encodable(`${label}: ${value}`), {
			x: 360,
			y: metaY,
			size: SIZE.small,
			font: regular,
			color: faint
		});
		metaY -= 11;
	}
	y -= 34;

	// The lines.
	// Everything but the position and the description is right-aligned: a
	// left-aligned quantity ran "1 Pauschale" into the price beside it.
	const columns = [
		[COLUMN.position, model.columns[0], false],
		[COLUMN.description, model.columns[1], false],
		[COLUMN.quantity, model.columns[2], true],
		[COLUMN.unitPrice, model.columns[3], true],
		[COLUMN.vat, model.columns[4], true],
		[COLUMN.net, model.columns[5], true]
	];
	const header = () => {
		for (const [x, label, alignRight] of columns) {
			write(String(label), {
				size: SIZE.small,
				font: bold,
				...(alignRight ? { alignRight: Number(x) } : { x: Number(x) })
			});
		}
		y -= 6;
		page.drawLine({
			start: { x: MARGIN.left, y },
			end: { x: A4.width - MARGIN.right, y },
			thickness: 0.7,
			color: faint
		});
		y -= 14;
	};
	header();

	for (const row of model.rows) {
		const description = wrap(String(row[1]), regular, SIZE.body, DESCRIPTION_WIDTH);
		room(30 + description.length * 13);
		if (y === A4.height - MARGIN.top) header();

		// The first line of the description carries the figures; a description
		// that needs more lines gets them underneath, still in its own column.
		row.forEach((cell, index) => {
			if (index === 1) return;
			const [x, , alignRight] = columns[index];
			write(String(cell), {
				size: SIZE.body,
				...(alignRight ? { alignRight: Number(x) } : { x: Number(x) })
			});
		});
		description.forEach((line, index) => {
			if (index > 0) y -= 13;
			write(line, { x: COLUMN.description, size: SIZE.body });
		});
		y -= 15;
	}

	// The totals, right under the line they belong to.
	y -= 4;
	page.drawLine({
		start: { x: 330, y },
		end: { x: A4.width - MARGIN.right, y },
		thickness: 0.7,
		color: faint
	});
	y -= 15;
	model.totals.forEach(([label, value], index) => {
		const last = index === model.totals.length - 1;
		write(String(label), { x: 330, font: last ? bold : regular });
		write(String(value), { alignRight: COLUMN.net, font: last ? bold : regular });
		y -= last ? 18 : 14;
	});

	// What the tax mode obliges the invoice to say, then the payment sentence.
	for (const text of [model.note, model.freeText, model.payment, model.iban]) {
		if (!text) continue;
		room(40);
		for (const line of wrap(text, regular, SIZE.body, A4.width - MARGIN.left - MARGIN.right)) {
			write(line);
			y -= 13;
		}
		y -= 6;
	}

	return pdf.save();
}

/**
 * Break a paragraph at the page width.
 *
 * @param {string} text
 * @param {any} font
 * @param {number} size
 * @param {number} width
 */
function wrap(text, font, size, width) {
	/** @type {string[]} */
	const lines = [];
	for (const paragraph of String(text).split('\n')) {
		let line = '';
		for (const word of paragraph.split(/\s+/)) {
			const candidate = line ? `${line} ${word}` : word;
			if (line && font.widthOfTextAtSize(encodable(candidate), size) > width) {
				lines.push(line);
				line = word;
			} else {
				line = candidate;
			}
		}
		lines.push(line);
	}
	return lines;
}
