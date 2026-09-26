import { describe, expect, it } from 'vitest';
import {
	TEMPLATE_BLOCKS,
	fillPlaceholders,
	parseTemplate,
	renderBlock,
	templateContext
} from './template.js';

describe('parseTemplate', () => {
	it('splits a document into the blocks the invoice knows', () => {
		const { blocks } = parseTemplate(
			'## Anschreiben\nSehr geehrte Damen und Herren,\n\n## Schluss\nMit freundlichen Grüßen'
		);
		expect(Object.keys(blocks).sort()).toEqual(TEMPLATE_BLOCKS.slice().sort());
		expect(blocks.intro).toBe('Sehr geehrte Damen und Herren,');
		expect(blocks.closing).toBe('Mit freundlichen Grüßen');
	});

	it('takes the English headings too, and ignores case and punctuation', () => {
		const { blocks } = parseTemplate('# Letter:\nDear Sir or Madam\n### SIGN-OFF\nKind regards');
		expect(blocks.intro).toBe('Dear Sir or Madam');
		expect(blocks.closing).toBe('Kind regards');
	});

	it('treats a document without headings as the letter', () => {
		// Somebody deletes the headings and writes. That is a letter, not nothing.
		const { blocks } = parseTemplate('Guten Tag,\n\nanbei die Rechnung.');
		expect(blocks.intro).toBe('Guten Tag,\n\nanbei die Rechnung.');
	});

	it('names a heading it does not know rather than swallowing its text', () => {
		const { blocks, unknown } = parseTemplate('## Anschreiben\nHallo\n\n## Mahnung\nBitte zahlen');
		expect(unknown).toEqual(['Mahnung']);
		expect(blocks.intro).toBe('Hallo');
		expect(Object.values(blocks)).not.toContain('Bitte zahlen');
	});
});

describe('fillPlaceholders', () => {
	const context = {
		nummer: '2026-48213-001',
		kunde: { name: 'Stromwerk Test AG' },
		aussteller: { geschaeftsfuehrer: 'Erika Mustermann' }
	};

	it('fills in what it knows, in German or English spelling', () => {
		const { text } = fillPlaceholders(
			'Rechnung {{nummer}} für {{kunde.name}}, {{ aussteller.geschaeftsfuehrer }}',
			context
		);
		expect(text).toBe('Rechnung 2026-48213-001 für Stromwerk Test AG, Erika Mustermann');
	});

	it('leaves a typo standing and reports it', () => {
		// A blank space in an invoice is invisible; {{kunde.nmae}} is not.
		const { text, missing } = fillPlaceholders('Guten Tag {{kunde.nmae}}', context);
		expect(text).toBe('Guten Tag {{kunde.nmae}}');
		expect(missing).toEqual(['kunde.nmae']);
	});
});

describe('templateContext', () => {
	it('offers the invoice’s own figures under both languages’ names', () => {
		const model = {
			number: '2026-48213-001',
			meta: [
				['Rechnungsdatum', '24.09.2026'],
				['Fälligkeitsdatum', '08.10.2026']
			],
			totals: [{ label: 'Zu zahlender Betrag EUR', value: '1.190,00', due: true }]
		};
		const invoice = {
			customer: {
				name: 'Stromwerk Test AG',
				address: 'Beispielweg 2\n54321 Beispielstadt',
				vatId: ''
			},
			issuer: {
				name: 'Wolkenfabrik UG',
				register: { managingDirector: 'Erika Mustermann' },
				bank: {}
			}
		};
		const context = templateContext(model, invoice);
		expect(context.nummer).toBe('2026-48213-001');
		expect(context.number).toBe('2026-48213-001');
		expect(context.betrag).toBe('1.190,00');
		expect(context.faellig).toBe('08.10.2026');
		expect(context.kunde.anschrift).toBe('Beispielweg 2, 54321 Beispielstadt');
		expect(context.aussteller.geschaeftsfuehrer).toBe('Erika Mustermann');
	});
});

describe('renderBlock', () => {
	it('makes paragraphs and bullets, and marks what is bold', () => {
		expect(renderBlock('Ein **wichtiger** Satz.\n\n- erster Punkt\n- zweiter')).toEqual([
			{
				kind: 'paragraph',
				runs: [
					{ text: 'Ein ', bold: false },
					{ text: 'wichtiger', bold: true },
					{ text: ' Satz.', bold: false }
				]
			},
			{ kind: 'bullet', runs: [{ text: 'erster Punkt', bold: false }] },
			{ kind: 'bullet', runs: [{ text: 'zweiter', bold: false }] }
		]);
	});

	it('keeps a line break somebody typed', () => {
		// Strict Markdown would join these two, which turns "Mit freundlichen
		// Grüßen / Erika Mustermann" into one line. Nobody writing a letter means that.
		const lines = renderBlock('Mit freundlichen Grüßen\nErika Mustermann');
		expect(lines.map((item) => item.runs[0].text)).toEqual([
			'Mit freundlichen Grüßen',
			'Erika Mustermann'
		]);
	});

	it('is empty for an empty block', () => {
		expect(renderBlock('')).toEqual([]);
		expect(renderBlock('   \n\n  ')).toEqual([]);
	});
});
