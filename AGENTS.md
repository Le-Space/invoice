# Working on this repository (for AI agents and people)

This repository is **public**. Invoices carry real data: the issuer's and the
customers' names and addresses, bank details, invoice numbers, amounts.

## Never put real data into the repository or onto GitHub

Not in issues, pull requests, comments, commit messages, code, tests,
fixtures, docs or screenshots:

- names, addresses, e-mail addresses and phone numbers of the issuer or of customers,
- IBANs, BICs, wallet addresses, tax numbers, VAT ids, register numbers,
- real invoice, customer or reference numbers, amounts and dates of real invoices,
- texts of real invoice lines, templates or mails,
- logs or network traces that contain any of the above.

Use made-up examples instead, as the specs do: _Wolkenfabrik Hosting GmbH_,
_Musterstraße 1, 12345 Musterstadt_, _DE00 0000 …_, _example.com_. Describe
the pattern, not the case.

## Other rules

- Issues, pull requests and commit messages in English; the app's UI in German
  (English second).
- Money is never a float: integer cents, crypto quantities as integer strings
  of the smallest unit.
- An issued invoice is never rewritten; a correction is a Storno plus a new
  invoice.
- Stage files by path (`git add <path>`), never `git add -A` / `git add .`.
- Never print or commit secrets: `.env`, tokens, keys.
- A pull request always against `main`, never stacked on another branch; check
  that a PR is still open before pushing to its branch.

## The books stay off the network

- OrbitDB and Helia run on the offline libp2p node (`app/src/lib/network.js`):
  no transport, no listen address, no discovery. Never give that node a
  transport, and never put OrbitDB, Bitswap or gossipsub on the UCEP node
  (`app/src/lib/ucep/net.js`), the one node that goes through a relay.
- The entries are sealed with `data` encryption only; there is no `replication`
  layer yet. Until the app has one, and a proof that only the right devices or
  people replicate (as Belege's `sync/device-gate.js`), this separation is what
  keeps the sealed books off any relay. `app/src/lib/node-separation.spec.js`
  fails when it changes.
