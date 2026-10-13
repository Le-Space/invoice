# Invoice

Invoices that live in your own store, not on somebody's server.

- **The core:** plain JavaScript for records, number series, templates, PDF and payment codes.
- **The app:** a PWA on that core, opened by a passkey. The books are sealed in the browser. A backup goes to Aleph Cloud as one sealed file. Paired apps such as [Belege](https://github.com/Le-Space/belege) ask it for receipts over [UCEP](https://github.com/Le-Space/ucep-spec).

This repository continues the invoice chapter `invoice01` of [Le-Space/simple-todo](https://github.com/Le-Space/simple-todo). The history of its core modules came along; references like `Le-Space/simple-todo#43` in old commit messages point to pull requests there.

## What works

- **Invoices in euros and in crypto** (BTC, ETH, USDC, POL, NYM, AKT):
  - a draft editor and chain templates;
  - issuing with the next number of this passkey's circle;
  - the PDF with a GiroCode or a payment code;
  - a Storno;
  - the VAT in euros on an invoice in another currency.
- **Passkeys:** a passkey opens the books. A second key, a YubiKey say, gets a slot of its own in the books' vault, and a key can be removed again.
- **Backup:** a backup of the books on Aleph Cloud, made from the browser. On an empty device the books come back with the paying account's address and a passkey that was registered when the backup was made.
- **Connections:** the UCEP `invoice` extension for paired apps:
  - Eigenbelege;
  - the issued invoices, with their net, VAT breakdown and the customer's VAT ID;
  - payments reported back.

Not yet: e-invoices, offers, sync between one's own devices. See [docs/roadmap.md](docs/roadmap.md).

## Two rules

- **The books stay off the network.** OrbitDB and Helia run on an offline node. Only two things leave the device:
  - a sealed backup, to Aleph;
  - while an app is paired, what that app asks for over UCEP, end-to-end encrypted through a relay.
- **An issued invoice is never rewritten.** A correction is a Storno plus a new invoice.

## Read more

| Topic                                             | English                                    | Deutsch                                          |
| ------------------------------------------------- | ------------------------------------------ | ------------------------------------------------ |
| The core modules                                  | [docs/core.md](docs/core.md)               | [docs/core.de.md](docs/core.de.md)               |
| Currencies, crypto invoices, payment codes        | [docs/currencies.md](docs/currencies.md)   | [docs/currencies.de.md](docs/currencies.de.md)   |
| The app: pages, passkeys, the vault, a second key | [docs/app.md](docs/app.md)                 | [docs/app.de.md](docs/app.de.md)                 |
| Backup and restore                                | [docs/backup.md](docs/backup.md)           | [docs/backup.de.md](docs/backup.de.md)           |
| Connections: the UCEP invoice extension           | [docs/connections.md](docs/connections.md) | [docs/connections.de.md](docs/connections.de.md) |
| What comes next                                   | [docs/roadmap.md](docs/roadmap.md)         | [docs/roadmap.de.md](docs/roadmap.de.md)         |

Working on this repository, for people and AI agents alike: [AGENTS.md](AGENTS.md). Never put real invoice data into the repository or onto GitHub.

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
