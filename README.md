# Invoice

Invoices that live in your own store, not on somebody's server: records,
number series, templates, PDF and payment codes, as plain JavaScript modules.

This repository continues the invoice chapter `invoice01` of
[Le-Space/simple-todo](https://github.com/Le-Space/simple-todo). The history of
its core modules came along; references like `Le-Space/simple-todo#43` in old
commit messages point to pull requests there.

## What is here

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
| `duplicates.js`                      | One number on two invoices is reported, not renumbered                                                              |

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

An invoice in a crypto currency carries a code instead of the GiroCode
(`payment-code.js`): BIP-21 for Bitcoin, EIP-681 for Ether, POL and USDC with
the amount in the chain's unit, and the address alone for NYM and AKT, where
wallets agree on no payment URI. The address comes from the issuer's settings
and is checked for its chain; an invoice without one cannot be issued.

A crypto invoice names the network it is paid on (`networks.js`): USDC and
Ether exist on several chains, and a payment on the wrong one does not arrive.
The code, the address line and the letter say it. Invoices from before networks
are read as paid on the first network of their currency (Ethereum for ETH and
USDC). `applyChainTemplate` sets a draft up for a chain — currency, decimals,
network, the usual lines — and `chainTemplateText` gives the letter to issue
it with, in German or English.

## The app

`app/` is a PWA (SvelteKit 2, Svelte 5) on the core. A passkey opens it: its
PRF answer derives the key every OrbitDB database is sealed with, and the
OrbitDB signing key, so nothing is readable on disk and no private key is kept
(`app/src/lib/node.js`, `database-keys.js`, `session-identities.js`). The
session and store layer comes from Le-Space/belege, where its author wrote it,
and is published here under MIT.

- Invoices: a list, a draft editor (customer, dates, tax mode, currency and
  network, the euro rate for the VAT, lines), issuing with the next number of
  this passkey's circle, the PDF, and a Storno.
- A new invoice can start from a chain template (NYM, AKT, BTC, ETH, USDC on
  Base).
- Settings: the issuer, the bank, the crypto addresses (checked for their
  network), the default tax mode and payment terms.

- Connections: the app serves the UCEP `invoice` extension
  ([Le-Space/ucep-spec](https://github.com/Le-Space/ucep-spec)) through a
  relay (`VITE_RELAY_ADDRS`, by default the Le-Space relay simple-todo uses).
  An app paired by invitation (link or QR code) or by a six-digit code asks
  for an Eigenbeleg (`create-eigenbeleg`), its state (`status`) and its PDF
  (`get-pdf`); a stranger gets `help` and nothing else. The peer id is derived
  from the passkey, the grants are kept sealed. The app connects to the relay
  only while an app is paired, or when asked to under "Verbindungen": the relay
  sees the device's IP address.

Not yet: pairing by QR code without any relay (the alpha module
`@le-space/libp2p-webrtc-qr` exchanges WebRTC signaling as QR codes), sync
between one's own devices, `create-draft`, and fetching a PDF by
CID over Bitswap on a relayed connection.

Later: e-invoices (EN 16931, ZUGFeRD/XRechnung), and the invoice extension of
[UCEP](https://github.com/Le-Space/ucep-spec) so that
[Belege](https://github.com/Le-Space/belege) can ask for a receipt over libp2p.

## Develop

```bash
pnpm install
pnpm test          # the core
pnpm lint
pnpm app:dev       # the app, on http://localhost:5173
pnpm app:test      # the app's unit specs
pnpm app:e2e       # the app in a browser, with a virtual passkey
```

## License

MIT, see [LICENSE](LICENSE). The embedded DejaVu font keeps its own licence.
