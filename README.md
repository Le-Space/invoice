# Invoice

Invoices that live in your own store, not on somebody's server: records,
number series, templates, PDF and payment codes, as plain JavaScript modules.

This repository continues the invoice chapter `invoice01` of
[Le-Space/simple-todo](https://github.com/Le-Space/simple-todo). The history of
its core modules came along; references like `Le-Space/simple-todo#43` in old
commit messages point to pull requests there.

## What is here

`src/core/` – pure modules, no network, no UI, each with its own spec:

| Module                        | Does                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `records.js`                  | The invoice record, issuing (the act that freezes it), Storno, `foldCancellations`              |
| `numbering.js`, `series.js`   | Number series per identity, e.g. `2026-00000-001`                                               |
| `currency.js`                 | The currencies an invoice can be in: EUR, USD, CHF, GBP, BTC, ETH, USDC, NYM, AKT, POL          |
| `money.js`                    | Integer smallest units as strings, rounding once, totals per VAT rate, VAT in euros             |
| `customers.js`, `settings.js` | Customer directory and issuer settings                                                          |
| `document.js`, `labels.js`    | The document model a PDF is drawn from, and the words it needs                                  |
| `template.js`                 | Letter and closing from a Markdown template the reader owns                                     |
| `pdf.js`                      | The PDF (pdf-lib, embedded DejaVu font)                                                         |
| `girocode.js`                 | EPC069-12 GiroCode for a SEPA transfer                                                          |
| `bip21.js`                    | BIP-21 URI for a Bitcoin payment, address checksum checked                                      |
| `eip681.js`                   | EIP-681 URI for Ether or an ERC-20 token on any EVM chain, EIP-55 checksum                      |
| `crypto-lines.js`             | Invoice lines from crypto transactions as Belege books them, with their source kept on the line |
| `duplicates.js`               | One number on two invoices is reported, not renumbered                                          |

`src/i18n/` – the German and English words of the printed invoice.

## Status

An invoice has a currency (`currency.js`). Every amount is an integer of its
smallest unit on the invoice, kept as a string: cents, satoshi, uNYM. Ether and
POL are invoiced in 10⁻⁸, so nobody has to read eighteen decimals;
`toChainUnits` scales to wei for a payment code or a booking.

An invoice in another currency than euros that shows VAT also states the VAT
in euros, with the rate, its source and its day (Art. 230 VAT Directive, §16
Abs. 6 UStG). Invoices written by the invoice01 chapter (euro cents in numbers)
are read through `upgradeInvoice`.

A crypto transaction booked in Belege becomes an invoice line with
`lineFromTransaction`: on an invoice in its own asset the price is the quantity,
on an invoice in euros the euro value Belege booked. The line says the quantity,
the rate with its source and day, and the transaction hash, and keeps all of it
in `line.source`. `eurRateOf` takes the booking's rate as the invoice's rate for
the VAT in euros.

Next in milestone M5:

1. Printing the BIP-21 / EIP-681 codes on a crypto invoice, with the address to
   pay to.
2. Templates per chain.
3. The app: a PWA with its own peer-to-peer store.

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
