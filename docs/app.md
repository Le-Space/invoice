# The app

_Deutsch: [app.de.md](app.de.md)_

`app/` is a PWA (SvelteKit 3, Svelte 5) on the core ([core.md](core.md)). It has three pages:

- **Rechnungen:**
  - a list and a draft editor (customer, dates, tax mode, currency and network, the euro rate for the VAT, lines);
  - issuing with the next number of this passkey's circle;
  - the PDF and a Storno.

  A new invoice can start from a chain template (NYM, AKT, BTC, ETH, USDC on Base).

- **Einstellungen:**
  - the issuer and the bank;
  - the crypto addresses, checked for their network;
  - the units offered for lines;
  - the default tax mode and payment terms;
  - the keys and the backup (below).
- **Verbindungen:** apps paired over UCEP ([connections.md](connections.md)).

## Passkeys and the books' vault

A passkey opens the app. Its PRF answer opens the books' vault, which holds:

- the key every OrbitDB database is sealed with;
- the database names;
- the UCEP peer seed;
- the secret of the books' own identity.

The books sign as that identity, and it is the root of every collection's access controller. So any passkey with a slot in the vault writes as the books; the passkey's DID is kept as each record's `author`. Books made before moved once to databases rooted at it; the old ones stay, read-only.

## A second key

Under Einstellungen → Schlüssel, a second passkey — a YubiKey, say — gets a slot of its own. A key can be removed, but never the last one and never the one in use; a key this browser does not keep, as a lost one usually is, can be removed too. A removed key opens nothing in this browser any more.

Removing a key renews the vault: a new vault key, file key and backup key, with a slot for every key that stays. Every key that stays, other than the one in use, is asked once, and the paying account has to allow the new backup key ([backup.md](backup.md#removing-a-key)).

## Backup and restore

Under Einstellungen → Sicherung the books go to Aleph Cloud as one sealed file with the vault in front, straight from the browser. A key from the vault signs the STORE message that keeps it, for a paying account that allowed that key once (belege's bridge account, `pnpm setup:aleph -- --authorize`).

- **Which passkey opens a backup:** any registered passkey can make one, but a backup opens only with the passkeys registered when it was made. A key added since needs a new backup, and the page names it until then.
- **On an empty device:** "Bücher aus einer Sicherung holen" needs two things:
  - the paying account's address, which is public but the only way to the backups;
  - a passkey registered when the backup was made.

  The newest backup with a slot for that passkey comes back, merged into the books.

- **A passkey without books here:** the app asks before it starts empty ones.
- **A removed key** opens no new backup, but still the ones made before.

Everything about it: [backup.md](backup.md).

## What is kept where

Nothing is readable on disk and no private key is kept (`app/src/lib/node.js`, `books-vault.js`, `books-move.js`, `session-identities.js`, `backup.js`). The books stay off the network: OrbitDB and Helia run on an offline node (`app/src/lib/network.js`), and the UCEP node, the one that goes through a relay, carries no database.

The session and store layer comes from Le-Space/belege, where its author wrote it, and is published here under MIT.
