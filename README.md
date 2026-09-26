# Invoice

Invoices that live in your own store, not on somebody's server: records,
number series, templates, PDF and payment codes, as plain JavaScript modules.

This repository continues the invoice chapter `invoice01` of
[Le-Space/simple-todo](https://github.com/Le-Space/simple-todo). The history of
its core modules came along; references like `Le-Space/simple-todo#43` in old
commit messages point to pull requests there.

## What is here

`src/core/` – pure modules, no network, no UI, each with its own spec:

| Module                        | Does                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `records.js`                  | The invoice record, issuing (the act that freezes it), Storno, `foldCancellations` |
| `numbering.js`, `series.js`   | Number series per identity, e.g. `2026-00000-001`                                  |
| `money.js`                    | Integer cents, rounding once, totals per VAT rate                                  |
| `customers.js`, `settings.js` | Customer directory and issuer settings                                             |
| `document.js`, `labels.js`    | The document model a PDF is drawn from, and the words it needs                     |
| `template.js`                 | Letter and closing from a Markdown template the reader owns                        |
| `pdf.js`                      | The PDF (pdf-lib, embedded DejaVu font)                                            |
| `girocode.js`                 | EPC069-12 GiroCode for a SEPA transfer                                             |
| `duplicates.js`               | One number on two invoices is reported, not renumbered                             |

`src/i18n/` – the German and English words of the printed invoice.

## Status

Euro only: `money.js` is built on euro cents. The plan (milestone M5):

1. Several currencies: a currency per invoice and the unit of its totals
   (records, money, PDF).
2. Invoice lines from crypto transactions (quantity in the smallest unit, as a
   string, with the rate and its source).
3. Payment codes next to the GiroCode: BIP-21 (Bitcoin) and EIP-681 (Ethereum,
   ERC-20), each as its own pure payload builder.
4. Templates per chain.
5. The app: a PWA with its own peer-to-peer store.

Later: e-invoices (EN 16931, ZUGFeRD/XRechnung), and the invoice extension of
[UCEP](https://github.com/Le-Space/ucep-spec) so that
[Belege](https://github.com/Le-Space/belege) can ask for a receipt over libp2p.

## Develop

```bash
pnpm install
pnpm test
pnpm lint
```

## License

MIT, see [LICENSE](LICENSE). The embedded DejaVu font keeps its own licence.
