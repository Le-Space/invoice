# The core

_Deutsch: [core.de.md](core.de.md)_

The app is built on these modules ([app.md](app.md)).

`src/core/` – pure modules, no network, no UI, each with its own spec:

| Module                               | Does                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `records.js`                         | The invoice record, issuing (the act that freezes it), Storno, `foldCancellations`                                  |
| `numbering.js`, `series.js`          | Number series per identity, e.g. `2026-00000-001`                                                                   |
| `currency.js`                        | The currencies an invoice can be in: EUR, USD, CHF, GBP, BTC, ETH, USDC, NYM, AKT, POL                              |
| `money.js`                           | Integer smallest units as strings, rounding once, totals per VAT rate, VAT in euros                                 |
| `customers.js`, `settings.js`        | Customer directory and issuer settings                                                                              |
| `document.js`, `labels.js`           | The document model a PDF is drawn from, and the words it needs                                                      |
| `template.js`                        | Letter and closing from a Markdown template the reader owns                                                         |
| `pdf.js`                             | The PDF (pdf-lib, embedded DejaVu font)                                                                             |
| `girocode.js`                        | EPC069-12 GiroCode for a SEPA transfer                                                                              |
| `bip21.js`                           | BIP-21 URI for a Bitcoin payment, address checksum checked                                                          |
| `eip681.js`                          | EIP-681 URI for Ether or an ERC-20 token on any EVM chain, EIP-55 checksum                                          |
| `crypto-lines.js`                    | Invoice lines from crypto transactions as Belege books them, with their source kept on the line                     |
| `payment-code.js`                    | The code a crypto invoice carries: BIP-21, EIP-681 (ETH, POL, USDC) or the address (NYM, AKT)                       |
| `networks.js`                        | The chains a crypto invoice is paid on, with Belege's chain ids and USDC contracts                                  |
| `chain-templates.js`                 | Templates per chain: currency, network, usual lines and a letter (NYM, AKT, BTC, ETH, USDC on Base)                 |
| `eigenbeleg.js`, `eigenbeleg-pdf.js` | Self-issued receipts (Eigenbelege) for UCEP `create-eigenbeleg`: checked arguments, their own number range, the PDF |
| `payments.js`                        | Payments reported for an issued invoice (UCEP `record-payment`): by reference, part payments, due day               |
| `duplicates.js`                      | One number on two invoices is reported, not renumbered                                                              |
| `xrechnung-rules.js`                 | What an XRechnung needs, checked before issuing: the BR-DE mandatory set, both electronic addresses, ISO currency   |
| `xrechnung.js`                       | An issued invoice as XRechnung (UN/CEFACT CII, XRechnung 3.0); a Storno as credit note 381                          |

`src/i18n/` – the German and English words of the printed invoice.
