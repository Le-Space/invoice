/**
 * The text blocks of an invoice, as Markdown the reader owns.
 *
 * The layout is drawn by `pdf.js` and stays where it is; what belongs to
 * whoever sends the invoice is the wording — the letter above the lines and the
 * closing under them. Those live in one small Markdown document that can be
 * edited in the app, downloaded, changed in any editor and uploaded again.
 *
 * Deliberately a subset: `## heading` opens a block, a blank line separates
 * paragraphs, `- ` makes a bullet, `**bold**` is bold. Anything else is left as
 * written rather than quietly reinterpreted — an invoice is not the place to
 * discover that a renderer has opinions.
 */

/** The blocks the invoice knows where to put. */
export const TEMPLATE_BLOCKS = ['intro', 'closing'];

/**
 * What a heading may be called. The keys are what the document uses; the names
 * are what somebody writing German or English would actually type.
 */
/** @type {Record<string, string[]>} */
const HEADINGS = {
	intro: ['intro', 'anschreiben', 'einleitung', 'letter', 'opening'],
	closing: ['closing', 'schluss', 'schlusstext', 'gruss', 'grussformel', 'sign-off']
};

/**
 * Split a template into its blocks.
 *
 * Text before the first heading belongs to `intro`, because that is what
 * somebody who deletes the headings and just writes a letter means.
 *
 * @param {string} markdown
 * @returns {{ blocks: Record<string, string>, unknown: string[] }}
 */
export function parseTemplate(markdown) {
	/** @type {Record<string, string>} */
	const blocks = {};
	/** @type {string[]} */
	const unknown = [];
	let current = 'intro';
	/** @type {string[]} */
	let buffer = [];

	const flush = () => {
		const text = buffer.join('\n').trim();
		// Text under a heading nobody knows is not printed: the editor says so
		// instead, which is the only way somebody finds out.
		if (text && !current.startsWith('unknown:')) {
			blocks[current] = blocks[current] ? `${blocks[current]}\n\n${text}` : text;
		}
		buffer = [];
	};

	for (const line of String(markdown ?? '').split(/\r?\n/)) {
		const heading = /^\s*#{1,6}\s+(.*?)\s*$/.exec(line);
		if (!heading) {
			buffer.push(line);
			continue;
		}
		flush();
		const name = heading[1].toLowerCase().replace(/[:.]+$/, '');
		const match = TEMPLATE_BLOCKS.find((block) => HEADINGS[block].includes(name));
		if (match) {
			current = match;
		} else {
			// A heading nobody knows is not silently dropped: it keeps its text
			// out of the invoice and is named, so the editor can say so.
			current = `unknown:${name}`;
			unknown.push(heading[1]);
		}
	}
	flush();

	return { blocks, unknown };
}

/**
 * The values a template may refer to, under German and English names.
 *
 * @param {any} model the document model
 * @param {any} invoice the issued invoice
 */
export function templateContext(model, invoice) {
	const issuer = invoice.issuer ?? {};
	const customer = invoice.customer ?? {};
	const register = issuer.register ?? {};
	const bank = issuer.bank ?? {};
	const total = model.totals.find((/** @type {any} */ row) => row.due) ?? { value: '' };
	const meta = Object.fromEntries(model.meta);

	const values = {
		number: model.number,
		date: meta[Object.keys(meta)[0]] ?? '',
		due: model.meta.find((/** @type {any} */ pair) => /f(ä|ae)llig|due/i.test(pair[0]))?.[1] ?? '',
		amount: total.value,
		currency: invoice.currency ?? 'EUR',
		/** The chain a crypto invoice is paid on, and the address it is paid to. */
		network: model.payCode?.network ?? '',
		payTo: model.payCode?.to ?? '',
		customer: {
			name: customer.name ?? '',
			address: (customer.address ?? '').replace(/\n/g, ', '),
			vatId: customer.vatId ?? ''
		},
		issuer: {
			name: issuer.name ?? '',
			address: (issuer.address ?? '').replace(/\n/g, ', '),
			managingDirector: register.managingDirector ?? '',
			email: issuer.email ?? '',
			phone: issuer.phone ?? '',
			web: issuer.web ?? '',
			bank: bank.name ?? '',
			iban: bank.iban ?? '',
			bic: bank.bic ?? ''
		}
	};

	// The same values, under the names somebody writing German reaches for.
	return {
		...values,
		nummer: values.number,
		datum: values.date,
		faellig: values.due,
		fällig: values.due,
		betrag: values.amount,
		waehrung: values.currency,
		währung: values.currency,
		netzwerk: values.network,
		adresse: values.payTo,
		kunde: {
			name: values.customer.name,
			anschrift: values.customer.address,
			ustid: values.customer.vatId
		},
		aussteller: {
			name: values.issuer.name,
			anschrift: values.issuer.address,
			geschaeftsfuehrer: values.issuer.managingDirector,
			geschäftsführer: values.issuer.managingDirector,
			email: values.issuer.email,
			telefon: values.issuer.phone,
			web: values.issuer.web,
			bank: values.issuer.bank,
			iban: values.issuer.iban,
			bic: values.issuer.bic
		}
	};
}

/**
 * Fill `{{placeholders}}` in, and say which ones nobody could.
 *
 * An unknown placeholder is left standing rather than blanked: a gap in an
 * invoice is invisible, `{{kunde.nmae}}` is not.
 *
 * @param {string} text
 * @param {any} context
 * @returns {{ text: string, missing: string[] }}
 */
export function fillPlaceholders(text, context) {
	/** @type {string[]} */
	const missing = [];
	const filled = String(text ?? '').replace(/\{\{\s*([\w.äöüÄÖÜß]+)\s*\}\}/g, (whole, path) => {
		const value = String(path)
			.split('.')
			.reduce((node, part) => (node == null ? undefined : node[part]), context);
		if (value === undefined || value === null || value === '') {
			missing.push(path);
			return whole;
		}
		return String(value);
	});
	return { text: filled, missing };
}

/**
 * A block as lines a renderer can draw: paragraphs and bullets, each with the
 * bold runs already marked.
 *
 * @param {string} markdown
 * @returns {{ kind: 'paragraph' | 'bullet', runs: { text: string, bold: boolean }[] }[]}
 */
export function renderBlock(markdown) {
	/** @type {{ kind: 'paragraph' | 'bullet', runs: { text: string, bold: boolean }[] }[]} */
	const out = [];
	/** @type {string[]} */
	let paragraph = [];

	const flush = () => {
		const text = paragraph.join(' ').trim();
		if (text) out.push({ kind: 'paragraph', runs: inlineRuns(text) });
		paragraph = [];
	};

	for (const line of String(markdown ?? '').split(/\r?\n/)) {
		const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
		if (bullet) {
			flush();
			out.push({ kind: 'bullet', runs: inlineRuns(bullet[1]) });
			continue;
		}
		if (line.trim() === '') {
			flush();
			continue;
		}
		// A line break somebody typed is a line break. Strict Markdown would
		// join these into one paragraph, which turns a sign-off into "Mit
		// freundlichen Grüßen Erika Mustermann" — and nobody typing a letter means
		// that. This is how the editors people actually use behave.
		paragraph.push(line.trim());
		flush();
	}
	flush();
	return out;
}

/**
 * Split a line into bold and plain runs.
 *
 * @param {string} text
 * @returns {{ text: string, bold: boolean }[]}
 */
function inlineRuns(text) {
	/** @type {{ text: string, bold: boolean }[]} */
	const runs = [];
	const pattern = /\*\*(.+?)\*\*/g;
	let last = 0;
	for (const match of text.matchAll(pattern)) {
		const index = match.index ?? 0;
		if (index > last) runs.push({ text: text.slice(last, index), bold: false });
		runs.push({ text: match[1], bold: true });
		last = index + match[0].length;
	}
	if (last < text.length) runs.push({ text: text.slice(last), bold: false });
	return runs.filter((run) => run.text !== '');
}
