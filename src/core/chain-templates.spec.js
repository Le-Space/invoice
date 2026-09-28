import { describe, expect, it } from 'vitest';
import de from '../i18n/de.json';
import {
	CHAIN_TEMPLATES,
	applyChainTemplate,
	chainTemplate,
	chainTemplateText
} from './chain-templates.js';
import { INVOICE_CURRENCIES } from './currency.js';
import { documentModel } from './document.js';
import { labelsFrom } from './labels.spec-helpers.js';
import { paysOn } from './networks.js';
import { parseTemplate } from './template.js';
import { draftProblems, emptyDraft, emptyLine, issue } from './records.js';

// Test vectors of BIP-173 and EIP-55.
const ISSUER = {
	name: 'Wolkenfabrik Hosting UG',
	address: 'Musterstraße 1\n12345 Musterstadt',
	crypto: {
		btc: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
		eth: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
	}
};
const CUSTOMER = {
	name: 'Stromwerk Test AG',
	address: 'Beispielweg 2\n54321 Beispielstadt',
	vatId: ''
};

describe('the chain templates', () => {
	it('are each paid on a network their currency is on, and write both languages', () => {
		for (const template of CHAIN_TEMPLATES) {
			expect(paysOn(template.currency, template.network)).toBe(true);
			for (const language of /** @type {const} */ (['de', 'en'])) {
				const { blocks, unknown } = parseTemplate(template.text[language]);
				expect(unknown).toEqual([]);
				expect(Object.keys(blocks).sort()).toEqual(['closing', 'intro']);
			}
		}
	});

	it('are for Bitcoin and Ethereum only, in currencies a new invoice is written in', () => {
		expect(CHAIN_TEMPLATES.map((template) => template.id)).toEqual([
			'bitcoin',
			'ethereum',
			'usdc-base'
		]);
		expect(chainTemplate('nym-node')).toBeNull();
		expect(chainTemplate('akash-provider')).toBeNull();
		for (const template of CHAIN_TEMPLATES) {
			expect(INVOICE_CURRENCIES).toContain(template.currency);
		}
	});
});

describe('applyChainTemplate', () => {
	it('sets currency, decimals and network, and leaves the empty line as it was', () => {
		const draft = applyChainTemplate(emptyDraft(), 'bitcoin');
		expect(draft).toMatchObject({
			currency: 'BTC',
			decimals: 8,
			network: 'bitcoin',
			chainTemplate: 'bitcoin'
		});
		// None of the templates suggests lines of its own.
		expect(draft.lines).toEqual([expect.objectContaining({ description: '', unitPrice: '0' })]);
		expect(applyChainTemplate(emptyDraft(), 'ethereum', { language: 'en' })).toMatchObject({
			currency: 'ETH',
			decimals: 8,
			network: 'ethereum'
		});
	});

	it('keeps lines somebody already wrote, with the figures they showed', () => {
		const written = {
			...emptyDraft(),
			lines: [emptyLine({ description: 'Beratung', unitPrice: '150' })]
		};
		const draft = applyChainTemplate(written, 'usdc-base');
		expect(draft).toMatchObject({ currency: 'USDC', decimals: 6, network: 'base' });
		expect(draft.lines).toEqual([
			expect.objectContaining({ description: 'Beratung', unitPrice: '1500000' })
		]);
	});

	it('refuses a template it does not know', () => {
		expect(() => applyChainTemplate(emptyDraft(), 'dogecoin')).toThrow();
		expect(chainTemplate('dogecoin')).toBeNull();
		expect(chainTemplateText('dogecoin')).toBe('');
	});
});

describe('an invoice made from a chain template', () => {
	it('says the currency, the network and the address in its letter', () => {
		const draft = {
			...applyChainTemplate(emptyDraft({ issueDate: '2026-09-24' }), 'usdc-base'),
			customer: CUSTOMER,
			taxMode: /** @type {const} */ ('reverse-charge'),
			lines: [emptyLine({ description: 'Beratung', quantity: 2, unitPrice: '50000000' })]
		};
		draft.customer = { ...CUSTOMER, vatId: 'NL000000000B01' };
		expect(draftProblems(draft, { issuer: ISSUER })).toEqual([]);
		const invoice = issue(draft, {
			number: '2026-00000-001',
			issuer: ISSUER,
			issuedBy: 'did',
			template: chainTemplateText('usdc-base')
		});
		const model = documentModel(invoice, labelsFrom(de));
		expect(model.missingPlaceholders).toEqual([]);
		const intro = model.intro.map((/** @type {any} */ block) =>
			block.runs.map((/** @type {any} */ run) => run.text).join('')
		);
		expect(intro).toContain(
			'für unsere Leistungen berechnen wir Ihnen die folgenden Positionen. Zahlbar in USDC im Netzwerk Base – eine Zahlung in einem anderen Netzwerk kommt bei uns nicht an.'
		);
		expect(model.payCode?.payload).toMatch(
			/^ethereum:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913@8453\//
		);
	});

	it('fills every placeholder in English too', () => {
		const draft = {
			...applyChainTemplate(emptyDraft({ issueDate: '2026-09-24' }), 'ethereum', {
				language: 'en'
			}),
			customer: CUSTOMER,
			taxMode: /** @type {const} */ ('kleinunternehmer')
		};
		draft.lines = [{ ...draft.lines[0], description: 'Consulting', unitPrice: '12500000' }];
		const invoice = issue(draft, {
			number: '2026-00000-002',
			issuer: ISSUER,
			issuedBy: 'did',
			template: chainTemplateText('ethereum', 'en')
		});
		expect(documentModel(invoice, labelsFrom(de)).missingPlaceholders).toEqual([]);
	});
});
