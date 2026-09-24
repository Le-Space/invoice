/**
 * The invoice as a file somebody can send.
 *
 * Drawn here rather than printed by the browser: a print dialogue adds its own
 * header, footer and page URL, and what comes out depends on the browser and
 * the person operating it. An invoice is a document that has to look the same
 * every time, carry its own file name and leave the app in one click.
 *
 * The layout follows the template this business already sends: the mark and the
 * issuer's block at the top, the address field where a window envelope expects
 * it, the lines, the sum, and on every page a foot that says who is charging,
 * who runs the company and where the money goes.
 *
 * `pdf-lib` and the QR encoder are loaded only when somebody exports, so the
 * page never pays for them. `document.js` decides what the invoice says; this
 * file only decides where it sits.
 */

import { documentModel } from './document.js';

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = { left: 56, right: 56, top: 48, bottom: 86 };
const SIZE = { tiny: 6.5, small: 8, body: 10, lead: 12, title: 15 };

/**
 * Where each column sits. Everything that carries a number is right-aligned on
 * its edge so the digits line up; the position and the description start at a
 * left edge. The gaps fit "1 Pauschale" beside "1.000,00 EUR", which is where
 * an earlier layout ran the two into each other.
 */
const COLUMN = {
	position: 56,
	description: 76,
	quantity: 338,
	unit: 348,
	unitPrice: 445,
	vat: 478,
	net: 539
};

/** How wide a description may be before it wraps onto the next line. */
const DESCRIPTION_WIDTH = 225;

/**
 * What the chosen font can put on the page.
 *
 * pdf-lib throws on a character the standard fonts cannot encode, which would
 * turn a pasted em dash or a Polish name into a failed export. Everything
 * outside WinAnsi is folded to something close rather than dropped silently.
 *
 * @param {unknown} value
 */
function encodable(value, embedded = false) {
	const text = String(value ?? '');
	// The embedded subset carries Latin-1, Latin Extended-A, the Romanian
	// letters and the punctuation people paste. Everything else would come out
	// as an empty box, so it is still folded to something close.
	if (embedded) {
		return text.replace(
			/[^\u0020-\u007E\u00A0-\u00FF\u0100-\u017F\u0218-\u021B\u20AC\u2010-\u2015\u2018-\u201E\u2020-\u2022\u2026\u2030\u2039\u203A\u2122\u2212]/g,
			'?'
		);
	}
	return text
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
	pdf.setTitle(`${model.title} ${model.number}`.trim());
	pdf.setProducer('simple-todo invoice01');
	const { regular, bold, embedded } = await embedFonts(pdf, StandardFonts);
	const ink = rgb(0.09, 0.09, 0.11);
	const faint = rgb(0.45, 0.45, 0.48);
	const rule = rgb(0.78, 0.78, 0.8);

	let page = pdf.addPage([A4.width, A4.height]);
	let y = A4.height - MARGIN.top;

	/**
	 * @param {string} text
	 * @param {{ x?: number, size?: number, font?: any, color?: any, alignRight?: number, center?: number }} [options]
	 */
	const write = (text, options = {}) => {
		const {
			x = MARGIN.left,
			size = SIZE.body,
			font = regular,
			color = ink,
			alignRight,
			center
		} = options;
		const value = encodable(text, embedded);
		if (value === '') return;
		const width = font.widthOfTextAtSize(value, size);
		const left =
			alignRight !== undefined ? alignRight - width : center !== undefined ? center - width / 2 : x;

		// Without an embedded font the euro sign gets its own run, placed by us.
		//
		// The font is not embedded, so a viewer substitutes its own Helvetica —
		// and where that one's euro advance differs from the metrics, everything
		// after it shifts: a rendered page read "1.190,00 \u20ACbis zum 02.10.2026".
		// Drawing the pieces at positions we compute makes the rest of the line
		// independent of that glyph; at worst the sign itself sits a hair off.
		const pieces = embedded ? [value] : value.split('\u20AC');
		if (pieces.length === 1) {
			page.drawText(value, { x: left, y, size, font, color });
			return;
		}
		let cursor = left;
		pieces.forEach((piece, index) => {
			// The space after the sign is drawn as advance rather than as a
			// character: a substituted glyph wider than its metric would
			// otherwise swallow it, which is exactly what happened.
			const text = index > 0 ? piece.replace(/^ /, '') : piece;
			if (text !== '') {
				page.drawText(text, { x: cursor, y, size, font, color });
				cursor += font.widthOfTextAtSize(text, size);
			}
			if (index < pieces.length - 1) {
				page.drawText('\u20AC', { x: cursor, y, size, font, color });
				cursor += font.widthOfTextAtSize('\u20AC ', size);
			}
		});
	};

	/**
	 * A label in bold and its value beside it, as one run.
	 *
	 * @param {{ label?: string, value: string, strong?: boolean }[]} cells
	 * @param {{ size?: number, alignRight?: number, center?: number, x?: number, gap?: number, color?: any }} options
	 */
	const writeRun = (
		cells,
		{ size = SIZE.small, alignRight, center, x = MARGIN.left, gap = 4, color = ink } = {}
	) => {
		const parts = cells.flatMap((cell, index) => {
			const prefix = index === 0 ? [] : [{ text: ' · ', font: regular, color: faint }];
			const label = cell.label
				? [{ text: encodable(cell.label, embedded), font: bold, color }]
				: [];
			const value = [
				{ text: encodable(cell.value, embedded), font: cell.strong ? bold : regular, color }
			];
			return [
				...prefix,
				...label,
				...(cell.label ? [{ text: ' ', font: regular, color }] : []),
				...value
			];
		});
		const width = parts.reduce(
			(sum, part) => sum + part.font.widthOfTextAtSize(part.text, size),
			0
		);
		let cursor =
			alignRight !== undefined ? alignRight - width : center !== undefined ? center - width / 2 : x;
		for (const part of parts) {
			page.drawText(part.text, { x: cursor, y, size, font: part.font, color: part.color });
			cursor += part.font.widthOfTextAtSize(part.text, size);
		}
		return width + gap;
	};

	/** A new page when the next block would not fit. */
	const room = (/** @type {number} */ needed) => {
		if (y - needed > MARGIN.bottom) return false;
		page = pdf.addPage([A4.width, A4.height]);
		y = A4.height - MARGIN.top;
		return true;
	};

	// The mark, top left. A logo nobody uploaded simply leaves the space empty.
	if (model.logo) {
		const image = await embedLogo(pdf, model.logo);
		if (image) {
			const size = 54;
			const scale = Math.min(size / image.width, size / image.height);
			page.drawImage(image, {
				x: MARGIN.left,
				y: A4.height - MARGIN.top - image.height * scale,
				width: image.width * scale,
				height: image.height * scale
			});
		}
	}

	// Who is charging, top right.
	for (const line of model.header) {
		writeRun([line], { size: SIZE.small, alignRight: A4.width - MARGIN.right });
		y -= 12;
	}

	// The address field, where a window envelope expects it.
	y = Math.min(y - 24, A4.height - 168);
	write(model.sender, { size: SIZE.tiny, color: faint });
	y -= 4;
	page.drawLine({
		start: { x: MARGIN.left, y },
		end: { x: 300, y },
		thickness: 0.5,
		color: rule
	});
	y -= 14;
	model.recipient.forEach((line, index) => {
		write(line, { size: SIZE.body, font: index === 0 ? bold : regular });
		y -= 14;
	});

	// Title and the dates beside it, right-aligned as a pair of columns.
	y = A4.height - 250;
	// Measured rather than guessed: "Rechnung:" sat on top of a number that was
	// wider than the space left for it.
	const numberWidth = bold.widthOfTextAtSize(encodable(model.number), SIZE.title);
	write(`${model.title}:`, {
		size: SIZE.title,
		font: bold,
		alignRight: COLUMN.net - numberWidth - 14
	});
	write(model.number, { size: SIZE.title, font: bold, alignRight: COLUMN.net });
	y -= 22;
	for (const [label, value] of model.meta) {
		write(`${label}:`, { size: SIZE.small, color: faint, alignRight: 432 });
		write(value, { size: SIZE.small, alignRight: COLUMN.net });
		y -= 13;
	}

	/**
	 * A block from the template: paragraphs and bullets, bold where it says so.
	 *
	 * @param {{ kind: string, runs: { text: string, bold: boolean }[] }[]} block
	 */
	const writeBlock = (block) => {
		for (const item of block) {
			const indent = item.kind === 'bullet' ? 12 : 0;
			const width = A4.width - MARGIN.right - MARGIN.left - indent;
			// Bold runs are measured with the bold font, so a wrapped line is
			// wrapped where it actually ends.
			const text = item.runs.map((run) => run.text).join('');
			const lines = wrap(text, regular, SIZE.body, width);
			let consumed = 0;
			lines.forEach((line, index) => {
				room(30);
				let cursor = MARGIN.left + indent;
				if (item.kind === 'bullet' && index === 0) {
					page.drawText('-', { x: MARGIN.left, y, size: SIZE.body, font: regular, color: ink });
				}
				// Walk the runs that fall inside this line.
				let remaining = line.length;
				while (remaining > 0) {
					const run = runAt(item.runs, consumed);
					if (!run) break;
					const piece = run.text.slice(consumed - run.start, consumed - run.start + remaining);
					const font = run.bold ? bold : regular;
					page.drawText(encodable(piece, embedded), {
						x: cursor,
						y,
						size: SIZE.body,
						font,
						color: ink
					});
					cursor += font.widthOfTextAtSize(encodable(piece, embedded), SIZE.body);
					consumed += piece.length;
					remaining -= piece.length;
				}
				consumed += 1; // the space the wrap consumed
				y -= 14;
			});
			y -= 4;
		}
	};

	// The letter above the lines.
	if (model.intro.length > 0) {
		y = Math.min(y - 8, A4.height - 322);
		writeBlock(model.intro);
		y -= 6;
	}

	// The lines.
	y = Math.min(y, A4.height - 330);
	const columns = [
		[COLUMN.position, model.columns[0], false],
		[COLUMN.description, model.columns[1], false],
		[COLUMN.quantity, model.columns[2], true],
		[COLUMN.unit, model.columns[3], false],
		[COLUMN.unitPrice, model.columns[4], true],
		[COLUMN.vat, model.columns[5], true],
		[COLUMN.net, model.columns[6], true]
	];
	/** Bullets sit in from the description, and their text wraps under itself. */
	const BULLET_INDENT = 10;
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
			color: rule
		});
		y -= 15;
	};
	header();

	for (const row of model.rows) {
		// A line is its own little block: what it is, what it was about, and
		// what was actually done. The figures sit on the first line of it.
		const title = wrap(row.description, bold, SIZE.body, DESCRIPTION_WIDTH);
		const subtitle = row.subtitle ? wrap(row.subtitle, regular, SIZE.small, DESCRIPTION_WIDTH) : [];
		const details = row.details.map((/** @type {string} */ detail) =>
			wrap(detail, regular, SIZE.small, DESCRIPTION_WIDTH - BULLET_INDENT)
		);
		const detailLines = details.reduce((sum, lines) => sum + lines.length, 0);
		const height = title.length * 14 + subtitle.length * 11 + detailLines * 11 + 12;
		if (room(Math.min(height, 200) + 20)) header();

		write(row.position, { x: COLUMN.position, size: SIZE.body });
		write(row.quantity, { alignRight: COLUMN.quantity, size: SIZE.body });
		write(row.unit, { x: COLUMN.unit, size: SIZE.body });
		write(row.unitPrice, { alignRight: COLUMN.unitPrice, size: SIZE.body });
		write(row.vat, { alignRight: COLUMN.vat, size: SIZE.body });
		write(row.net, { alignRight: COLUMN.net, size: SIZE.body });

		title.forEach((line, index) => {
			if (index > 0) y -= 14;
			write(line, { x: COLUMN.description, size: SIZE.body, font: bold });
		});
		y -= 13;

		for (const line of subtitle) {
			write(line, { x: COLUMN.description, size: SIZE.small, color: faint });
			y -= 11;
		}

		for (const detail of details) {
			detail.forEach((line, index) => {
				room(24);
				if (index === 0) {
					page.drawText('-', {
						x: COLUMN.description,
						y,
						size: SIZE.small,
						font: regular,
						color: ink
					});
				}
				write(line, { x: COLUMN.description + BULLET_INDENT, size: SIZE.small });
				y -= 11;
			});
		}

		y -= subtitle.length > 0 || details.length > 0 ? 8 : 3;
	}

	page.drawLine({
		start: { x: MARGIN.left, y: y + 4 },
		end: { x: A4.width - MARGIN.right, y: y + 4 },
		thickness: 0.5,
		color: rule
	});
	y -= 8;
	write(model.netNote, { size: SIZE.small, color: faint });
	if (model.deliveryNote) {
		write(model.deliveryNote, { size: SIZE.small, color: faint, alignRight: COLUMN.net });
	}
	y -= 28;

	// The sum, right under the lines it sums.
	room(120);
	for (const total of model.totals) {
		if (total.due) {
			y -= 8;
			write(total.label, { x: 300, size: SIZE.lead, font: bold });
			write(total.value, { alignRight: COLUMN.net, size: SIZE.lead, font: bold });
			y -= 20;
			continue;
		}
		// The template draws one rule, right above the total it leads to.
		if (total.strong) {
			page.drawLine({
				start: { x: 300, y: y + 13 },
				end: { x: A4.width - MARGIN.right, y: y + 13 },
				thickness: 0.6,
				color: rule
			});
		}
		write(total.label, { x: 300, size: SIZE.body, font: total.strong ? bold : regular });
		write(total.value, {
			alignRight: COLUMN.net,
			size: SIZE.body,
			font: total.strong ? bold : regular
		});
		y -= 16;
	}

	// What the tax mode obliges the invoice to say.
	for (const text of [model.note, model.freeText]) {
		if (!text) continue;
		room(40);
		for (const line of wrap(text, regular, SIZE.body, A4.width - MARGIN.left - MARGIN.right)) {
			write(line, { size: SIZE.body });
			y -= 14;
		}
		y -= 6;
	}

	// How to pay, with the code that fills the transfer in.
	room(110);
	y -= 10;
	const textLeft = model.giro ? 190 : MARGIN.left;
	const textWidth = A4.width - MARGIN.right - textLeft;
	/** Where the QR code ends, so whatever follows starts below it. */
	let giroBottom = null;
	if (model.giro) {
		const top = y + 6;
		const code = 96;
		await drawQrCode(page, model.giro.payload, { x: MARGIN.left, top, size: code, ink });
		// The caption belongs under the code, not across it.
		const resume = y;
		y = top - code - 11;
		write(model.giro.caption, { x: MARGIN.left, size: SIZE.small, font: bold, color: faint });
		giroBottom = y - 6;
		y = resume;
	}
	for (const line of wrap(model.payment, regular, SIZE.body, textWidth)) {
		write(line, { x: textLeft, size: SIZE.body });
		y -= 14;
	}
	if (model.giro) {
		y -= 4;
		for (const line of wrap(model.giro.hint, regular, SIZE.small, textWidth)) {
			write(line, { x: textLeft, size: SIZE.small, color: faint });
			y -= 12;
		}
	}

	// The closing, under everything the invoice had to say — including the code
	// beside the payment sentence, which reaches further down than the text.
	if (model.closing.length > 0) {
		if (giroBottom !== null) y = Math.min(y, giroBottom);
		room(60);
		y -= 18;
		writeBlock(model.closing);
	}

	// The foot of every page, once the number of pages is known.
	const pages = pdf.getPages();
	pages.forEach((sheet, index) => {
		page = sheet;
		y = MARGIN.bottom - 10;
		page.drawLine({
			start: { x: MARGIN.left, y: MARGIN.bottom + 6 },
			end: { x: A4.width - MARGIN.right, y: MARGIN.bottom + 6 },
			thickness: 0.5,
			color: rule
		});
		for (const line of model.footer) {
			writeRun(line, { size: SIZE.tiny, center: A4.width / 2, color: faint });
			y -= 10;
		}
		write(
			(labels.page ?? 'Seite {page} von {pages}')
				.replace('{page}', String(index + 1))
				.replace('{pages}', String(pages.length)) + ` · ${model.title} ${model.number}`,
			{ size: SIZE.tiny, color: faint, center: A4.width / 2 }
		);
	});

	return pdf.save();
}

/**
 * The font the document is drawn with.
 *
 * The subset in `fonts/dejavu.js` is embedded, so the file carries its own
 * letters and no viewer substitutes anything. If that fails for any reason the
 * export still happens, with pdf-lib's standard Helvetica and the folding that
 * goes with it — an invoice somebody can send beats an exception.
 *
 * @param {any} pdf
 * @param {any} StandardFonts
 */
async function embedFonts(pdf, StandardFonts) {
	try {
		const [{ default: fontkit }, { BOLD, REGULAR }] = await Promise.all([
			import('@pdf-lib/fontkit'),
			import('./fonts/dejavu.js')
		]);
		pdf.registerFontkit(fontkit);
		const [regular, bold] = await Promise.all([
			pdf.embedFont(fromBase64(REGULAR), { subset: true }),
			pdf.embedFont(fromBase64(BOLD), { subset: true })
		]);
		return { regular, bold, embedded: true };
	} catch {
		return {
			regular: await pdf.embedFont(StandardFonts.Helvetica),
			bold: await pdf.embedFont(StandardFonts.HelveticaBold),
			embedded: false
		};
	}
}

/** @param {string} value */
function fromBase64(value) {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

/**
 * The logo, if it is an image pdf-lib can embed.
 *
 * Uploads are stored as PNG (the settings form draws whatever was picked onto a
 * canvas first), so this is the common case; a JPEG that arrived some other way
 * still works, and anything else is left out rather than failing the export.
 *
 * @param {any} pdf
 * @param {string} dataUrl
 */
async function embedLogo(pdf, dataUrl) {
	try {
		if (/^data:image\/png/i.test(dataUrl)) return await pdf.embedPng(dataUrl);
		if (/^data:image\/jpe?g/i.test(dataUrl)) return await pdf.embedJpg(dataUrl);
	} catch {
		// A logo that cannot be read is not a reason to withhold the invoice.
	}
	return null;
}

/**
 * Draw a QR code as filled squares.
 *
 * @param {any} page
 * @param {string} payload
 * @param {{ x: number, top: number, size: number, ink: any }} options
 */
async function drawQrCode(page, payload, { x, top, size, ink }) {
	const { encode } = await import('uqr');
	const code = encode(payload, { ecc: 'M' });
	const module = size / code.size;
	for (let row = 0; row < code.size; row += 1) {
		for (let column = 0; column < code.size; column += 1) {
			if (!code.data[row][column]) continue;
			page.drawRectangle({
				x: x + column * module,
				y: top - (row + 1) * module,
				width: module,
				height: module,
				color: ink
			});
		}
	}
}

/**
 * Which run a character index falls in, with the index that run starts at.
 *
 * @param {{ text: string, bold: boolean }[]} runs
 * @param {number} index
 */
function runAt(runs, index) {
	let start = 0;
	for (const run of runs) {
		if (index < start + run.text.length) return { ...run, start };
		start += run.text.length;
	}
	return null;
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
