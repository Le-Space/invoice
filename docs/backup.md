# Backup on Aleph Cloud

_Deutsch: [backup.de.md](backup.de.md)_

A backup holds everything these books keep: invoices, customers and settings, the list of backups included. It is one file. In front is the books' vault, as this browser keeps it. Behind the vault are the collections, sealed with a key from that vault. Aleph Cloud keeps the file. A passkey that had a slot in the vault when the backup was made can open it on any device. Nobody else can, Aleph included.

## What you need to get the books back

On an empty device, two things:

1. **The paying account's address.** The app finds backups only through the account that pays for them: it asks Aleph for that account's STORE messages on the channel `INVOICE-BACKUP`. The address is public, but nothing else leads to the backups; the books' own backup key is sealed in the vault. Write the address down, ideally where the second key is kept.
2. **A passkey that was registered when the backup was made.** Each backup carries the vault as it was then, with one slot for each passkey registered then. The app takes the newest backup with a slot for the passkey you confirm. Not just any passkey: one added later opens only the backups made after it, and a passkey of other books opens none.

## Set up once

1. The paying account is the one belege's bridge uses: `pnpm setup:aleph` in belege's folder prints its address. It needs credits (app.aleph.cloud → Credits). Aleph charges about 54 credits per MiB and day, and refuses a backup when the account has less than a day of it; the page then says how many credits it takes.
2. Under _Einstellungen → Sicherung_, enter that address ("Konto übernehmen"). The page shows the address of the books' backup key. Until the account allows that key, the page also shows the command to run once in belege's folder:

   ```sh
   pnpm setup:aleph -- --authorize <address> --channel INVOICE-BACKUP
   ```

   "Erneut prüfen" reads the grant back.

The backup key and the file key are kept in the vault, so they are the same for every passkey of the books. One grant serves all of them.

## Back up

_Einstellungen → Sicherung → "Jetzt sichern"_.

1. The browser packs and seals the backup.
2. It uploads the file to Aleph's IPFS host.
3. It signs the STORE message with the books' backup key, for the paying account, paid in credits.
4. It waits until Aleph has decided.

The bridge does not have to run. Under "Bisherige Sicherungen", each backup says which passkeys open it.

**After adding a key, back up again.** A backup opens only with the passkeys registered when it was made. Until the next backup, the page names the keys the newest backup does not know.

## Restore on an empty device

On the first screen, or on the lock screen: _"Bücher aus einer Sicherung holen"_, with the account's address. Then confirm the passkey.

1. The account's backups are listed, before any prompt.
2. The passkey comes from its authenticator, as with "Passkey wiederherstellen" (two prompts).
3. The app chooses the newest backup with a slot for that passkey. It goes by the credential id alone, with no further prompt.
4. That backup's vault goes into this browser, and the books are unlocked as usual (one prompt).
5. The backup is put back into the books. This merges: what is here stays, what the backup holds is added, nothing is deleted. The backup then shows in the list.

Three prompts in all. If no backup has a slot for the passkey, the page says so and nothing changes.

"Passkey wiederherstellen" with a passkey this browser has no books for now asks first. Confirmed, it makes new, empty books. Declined, nothing is made and the passkey is not kept, so the backup can be fetched instead.

## Removing a key

Removing a key takes its slot out of the vault here, and so out of every backup made afterwards. It does not reach the backups made before:

- they still carry the key's slot, and the key opens them;
- anyone who knows the paying account can fetch them;
- what the key finds there includes the file key, which removing does not renew, so with one such backup it can read later backup files too.

A lost security key is still protected by its PIN. Against a stolen key with its PIN, removing it is not enough: the books would have to move to new secrets, which the app cannot do yet.

## What leaves this device

- **To Aleph's IPFS host:** the sealed file. Aleph sees its size and this device's IP address, not the books. The vault in front can be read without a key, but it shows only:
  - one id per slot, which is the SHA-256 of a credential id;
  - the sealed slots;
  - the sealed values.
- **To the Aleph API:**
  - the STORE message, with the address of the books' backup key, the account's address and the file's id;
  - reads of the account's grants and credits;
  - on restore, the request for the account's list of backups.
- **From Aleph's gateway, on restore:** the backup files, newest first, at most 20, until one opens with the passkey.

## Technical

- **Format:** the storage bridge's application backup `OSBA` (`@le-space/orbitdb-storage-bridge/app-backup`).
  - The header is the vault record as JSON: version 1, AES-GCM, an id, the sealed payload, and slots with `kid`, `iv` and `ciphertext`.
  - The body is the three collections, block by block (`bundleDatabases`), as one CAR file sealed with AES-GCM under the vault's `backupKey`.
  - The manifest inside names the header's SHA-256, so a changed header is refused.
- **Keys:** the vault (version 3) holds `backupKey` (AES-GCM) and `alephKey` (secp256k1), 32 random bytes each. They sit next to the database key, the database names, the peer seed and the secret of the books' identity, and are the same for every slot.
- **STORE:**
  - channel `INVOICE-BACKUP`, `content.address` set to the paying account, `payment: { type: "credit" }`;
  - signed with `personal_sign` by the `alephKey`;
  - the account allows that key in its `security` aggregate: STORE only, this channel only. Aleph charges the account, not the key (measured 2026-10-03).
- **Finding:**
  1. `messages.json?owners=<account>&channels=INVOICE-BACKUP` lists the backups (`listAlephStores`).
  2. The files come from `ipfs.aleph.cloud/ipfs/<cid>`.
  3. Each header is read without a key.
  4. The first, newest-first, whose vault has a slot with `kid` = SHA-256 of the passkey's credential id is taken.
- **Restore:**
  - The vault is put into this browser unless it would clash: when a vault here for other books already opens with one of its keys, the backup is refused.
  - The books open at their own addresses, and `restoreAppBackup` merges and refuses other books.
  - On a failure, the vault put in is taken out again, and a passkey without books here is not kept.
- **History:** kept in the sealed settings (`backup/history`, the newest 50). Each record carries the slot ids of the vault the backup carries; the page compares them with the slots there are now.

Code: `app/src/lib/backup.js`, `books-vault.js`, `session.svelte.js`, `BackupSection.svelte`.
