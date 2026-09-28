/**
 * Templates per chain: an invoice for one network, ready to be filled in.
 *
 * A template bundles what somebody invoicing on that chain would otherwise set
 * by hand each time: the currency, the network it is paid on, the lines such
 * an invoice usually has, and the wording — a letter that says in which
 * currency and on which network to pay, because a payment on another chain
 * does not arrive.
 *
 * The wording is Markdown as `template.js` reads it, with the placeholders
 * `{{netzwerk}}` and `{{waehrung}}` next to the usual ones (`{{adresse}}` is
 * there too; the payment section already prints it beside the code); it is
 * frozen with the invoice when it is issued, like any other template.
 */

import { currencyOf } from './currency.js';
import { paysOn } from './networks.js';
import { toUnits } from './money.js';
import { emptyLine, setCurrency } from './records.js';

/**
 * @typedef {object} ChainTemplate
 * @property {string} id
 * @property {{ de: string, en: string }} name
 * @property {string} currency
 * @property {string} network
 * @property {{ de: string, en: string, unit: { de: string, en: string } }[]} lines
 *   what such an invoice usually charges; empty for a template that suggests none
 * @property {{ de: string, en: string }} text Markdown with an intro and a closing
 */

/**
 * The letter every chain template shares, around what is invoiced.
 *
 * @param {{ de: string, en: string }} what
 */
const letter = (what) => ({
	de: `## Anschreiben

Sehr geehrte Damen und Herren,

${what.de} Zahlbar in **{{waehrung}}** im Netzwerk **{{netzwerk}}** – eine Zahlung in einem anderen Netzwerk kommt bei uns nicht an.

## Schluss

Vielen Dank für die Zusammenarbeit.

Mit freundlichen Grüßen
{{aussteller.name}}
`,
	en: `## Letter

Dear Sir or Madam,

${what.en} Payable in **{{currency}}** on the **{{network}}** network – a payment on any other network does not reach us.

## Closing

Thank you for working with us.

Kind regards
{{issuer.name}}
`
});

/** @type {readonly ChainTemplate[]} */
export const CHAIN_TEMPLATES = Object.freeze([
	{
		id: 'bitcoin',
		name: { de: 'BTC – Zahlung in Bitcoin', en: 'BTC – payment in bitcoin' },
		currency: 'BTC',
		network: 'bitcoin',
		lines: [],
		text: letter({
			de: 'für unsere Leistungen berechnen wir Ihnen die folgenden Positionen.',
			en: 'for our services we invoice you as follows.'
		})
	},
	{
		id: 'ethereum',
		name: { de: 'ETH – Zahlung auf Ethereum', en: 'ETH – payment on Ethereum' },
		currency: 'ETH',
		network: 'ethereum',
		lines: [],
		text: letter({
			de: 'für unsere Leistungen berechnen wir Ihnen die folgenden Positionen.',
			en: 'for our services we invoice you as follows.'
		})
	},
	{
		id: 'usdc-base',
		name: { de: 'USDC – Zahlung auf Base', en: 'USDC – payment on Base' },
		currency: 'USDC',
		network: 'base',
		lines: [],
		text: letter({
			de: 'für unsere Leistungen berechnen wir Ihnen die folgenden Positionen.',
			en: 'for our services we invoice you as follows.'
		})
	}
]);

/**
 * @param {string} id
 * @returns {ChainTemplate | null}
 */
export function chainTemplate(id) {
	return CHAIN_TEMPLATES.find((template) => template.id === id) ?? null;
}

/**
 * The wording of a template, to be passed as `template` when the invoice is
 * issued.
 *
 * @param {string} id
 * @param {'de' | 'en'} [language]
 */
export function chainTemplateText(id, language = 'de') {
	return chainTemplate(id)?.text[language] ?? '';
}

/**
 * A draft set up for a chain: its currency with its decimals (prices keep the
 * figures they showed, as `setCurrency` does), the network, and — when the
 * draft has no line of its own yet — the lines such an invoice usually has.
 *
 * @template {Record<string, any>} D
 * @param {D} draft
 * @param {string} id
 * @param {{ language?: 'de' | 'en' }} [options]
 */
export function applyChainTemplate(draft, id, { language = 'de' } = {}) {
	const template = chainTemplate(id);
	if (!template || !currencyOf(template.currency) || !paysOn(template.currency, template.network)) {
		throw new Error(`Unknown chain template: ${id}`);
	}
	const next = setCurrency(/** @type {any} */ (draft), template.currency);
	const untouched = (next.lines ?? []).every(
		(/** @type {any} */ line) =>
			!String(line.description ?? '').trim() && (toUnits(line.unitPrice) ?? 0n) === 0n
	);
	return {
		...next,
		network: template.network,
		chainTemplate: template.id,
		lines:
			untouched && template.lines.length > 0
				? template.lines.map((line) =>
						emptyLine({ description: line[language], unit: line.unit[language] })
					)
				: next.lines
	};
}
