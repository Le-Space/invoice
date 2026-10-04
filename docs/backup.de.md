# Sicherung bei Aleph Cloud

_English: [backup.md](backup.md)_

Eine Sicherung enthält alles, was diese Bücher halten: Rechnungen, Kunden und Einstellungen, die Liste der Sicherungen eingeschlossen. Sie ist eine Datei. Vorn steht der Tresor der Bücher, so wie dieser Browser ihn hält. Dahinter stehen die Sammlungen, versiegelt mit einem Schlüssel aus diesem Tresor. Aleph Cloud bewahrt die Datei auf. Ein Passkey, der beim Sichern ein Fach im Tresor hatte, öffnet sie auf jedem Gerät. Sonst niemand, auch Aleph nicht.

## Was du brauchst, um die Bücher zurückzuholen

Auf einem leeren Gerät zwei Dinge:

1. **Die Adresse des zahlenden Kontos.** Die App findet Sicherungen nur über das Konto, das sie bezahlt: Sie fragt Aleph nach dessen STORE-Nachrichten im Kanal `INVOICE-BACKUP`. Die Adresse ist öffentlich, aber nichts anderes führt zu den Sicherungen; der Sicherungsschlüssel der Bücher steckt versiegelt im Tresor. Schreib die Adresse auf, am besten dorthin, wo der zweite Schlüssel liegt.
2. **Einen Passkey, der beim Sichern eingetragen war.** Jede Sicherung trägt den Tresor so, wie er damals war, mit einem Fach für jeden damals eingetragenen Passkey. Die App nimmt die neueste Sicherung mit einem Fach für den Passkey, den du bestätigst. Nicht irgendeinen: Ein später hinzugefügter öffnet erst die Sicherungen danach, und ein Passkey anderer Bücher öffnet keine.

## Einmal einrichten

1. Es zahlt das Konto der belege-Bridge: `pnpm setup:aleph` im Ordner von belege zeigt seine Adresse. Es braucht Credits (app.aleph.cloud → Credits). Aleph berechnet etwa 54 Credits pro MiB und Tag und lehnt eine Sicherung ab, wenn das Konto nicht für einen Tag reicht; die Seite sagt dann, wie viele Credits es braucht.
2. Unter _Einstellungen → Sicherung_ diese Adresse eintragen („Konto übernehmen“). Die Seite zeigt die Adresse des Sicherungsschlüssels der Bücher. Solange das Konto diesen Schlüssel nicht freigegeben hat, zeigt sie auch den Befehl, der einmal im Ordner von belege läuft:

   ```sh
   pnpm setup:aleph -- --authorize <Adresse> --channel INVOICE-BACKUP
   ```

   „Erneut prüfen“ liest die Freigabe zurück.

Sicherungs- und Dateischlüssel liegen im Tresor und sind daher für jeden Passkey der Bücher gleich. Eine Freigabe reicht für alle.

## Sichern

_Einstellungen → Sicherung → „Jetzt sichern“_.

1. Der Browser packt und versiegelt die Sicherung.
2. Er lädt die Datei zu Alephs IPFS-Host hoch.
3. Er unterschreibt die STORE-Nachricht mit dem Sicherungsschlüssel der Bücher, für das zahlende Konto, bezahlt mit Credits.
4. Er wartet, bis Aleph entschieden hat.

Die Bridge muss dafür nicht laufen. Unter „Bisherige Sicherungen“ steht bei jeder Sicherung, welche Passkeys sie öffnen.

**Nach dem Hinzufügen eines Schlüssels neu sichern.** Eine Sicherung öffnen nur die Passkeys, die beim Sichern eingetragen waren. Bis zur nächsten Sicherung nennt die Seite die Schlüssel, die die neueste Sicherung nicht kennt.

## Wiederherstellen auf einem leeren Gerät

Auf dem ersten Bildschirm oder dem Sperrbildschirm: _„Bücher aus einer Sicherung holen“_, mit der Adresse des Kontos. Danach den Passkey bestätigen.

1. Die Sicherungen des Kontos werden gelistet, noch vor jeder Abfrage.
2. Der Passkey kommt aus seinem Authenticator, wie bei „Passkey wiederherstellen“ (zwei Abfragen).
3. Die App wählt die neueste Sicherung mit einem Fach für diesen Passkey. Sie richtet sich allein nach der Credential-ID, ohne weitere Abfrage.
4. Der Tresor dieser Sicherung kommt in diesen Browser, und die Bücher werden wie gewohnt entsperrt (eine Abfrage).
5. Die Sicherung wird in die Bücher zurückgespielt. Das führt zusammen: Was hier ist, bleibt; was die Sicherung enthält, kommt dazu; gelöscht wird nichts. Danach steht die Sicherung in der Liste.

Insgesamt drei Abfragen. Hat keine Sicherung ein Fach für den Passkey, sagt die Seite das, und nichts ändert sich.

„Passkey wiederherstellen“ mit einem Passkey, für den dieser Browser keine Bücher hat, fragt jetzt vorher. Bestätigt, legt es neue, leere Bücher an. Abgelehnt, wird nichts angelegt und der Passkey nicht behalten; die Sicherung lässt sich dann stattdessen holen.

## Einen Schlüssel entfernen

_Einstellungen → Schlüssel → „Entfernen“_, auch für einen Schlüssel, den dieser Browser nicht hinterlegt hat, wie meist einen verlorenen. Entfernen erneuert den Tresor:

- **Neue Schlüssel.** Der Tresor bekommt einen neuen Tresorschlüssel, einen neuen Dateischlüssel (`backupKey`) und einen neuen Sicherungsschlüssel (`alephKey`). Der entfernte Schlüssel kannte den alten Tresorschlüssel, und jede Sicherung trägt den Tresor vorn; ein neuer Dateischlüssel unter dem alten Tresorschlüssel wäre für ihn kein Geheimnis.
- **Ein Fach für jeden Schlüssel, der bleibt.** Der Schlüssel, mit dem entsperrt ist, wird nicht gefragt. Jeder weitere, der bleibt, wird einmal gefragt (eine Berührung). Einen, der bleibt, aber in diesem Browser nicht hinterlegt ist, kann die App nicht fragen, und nichts ändert sich: Entsperre einmal mit ihm („Passkey wiederherstellen“), dann entferne.
- **Eine neue Freigabe.** Der neue Sicherungsschlüssel hat eine neue Adresse, die das zahlende Konto noch nicht freigegeben hat. _Einstellungen → Sicherung_ zeigt den Befehl dafür und den, der die Freigabe des alten zurücknimmt:

  ```sh
  pnpm setup:aleph -- --authorize <neue Adresse> --channel INVOICE-BACKUP
  pnpm setup:aleph -- --revoke <alte Adresse>
  ```

  Solange die alte Freigabe besteht, kann der entfernte Schlüssel auf Kosten des Kontos weiter Dateien in `INVOICE-BACKUP` aufbewahren lassen. Die Seite nennt die alte Adresse, bis das Konto sie nicht mehr erlaubt.

Was Entfernen nicht erreicht:

- die Sicherungen davor tragen das Fach des entfernten Schlüssels weiter, und er öffnet sie;
- jeder, der das zahlende Konto kennt, kann sie abrufen;
- Datenbankschlüssel, Datenbanknamen und die Identität der Bücher bleiben dieselben.

Neue Sicherungen öffnet der entfernte Schlüssel ab dann nicht mehr: Er hat kein Fach in ihrem Tresor, und was er kannte, öffnet die Datei nicht. Einen verlorenen Sicherheitsschlüssel schützt weiter seine PIN. Gegen einen gestohlenen samt PIN reicht Entfernen für das, was er schon gesehen hat, nicht: Die Bücher müssten auf neue Geheimnisse umziehen, und das kann die App noch nicht.

Andere Browser mit einer Kopie dieser Bücher behalten die alten Schlüssel. Führe die Bücher in einem Browser; ein anderer holt sie sich aus einer Sicherung.

## Was hinausgeht

- **An Alephs IPFS-Host:** die versiegelte Datei. Aleph sieht ihre Größe und die IP-Adresse dieses Geräts, nicht die Bücher. Den Tresor vorn kann man ohne Schlüssel lesen, er zeigt aber nur:
  - eine Kennung je Fach, also den SHA-256 einer Credential-ID;
  - die versiegelten Fächer;
  - die versiegelten Werte.
- **An die Aleph-API:**
  - die STORE-Nachricht mit der Adresse des Sicherungsschlüssels der Bücher, der Adresse des Kontos und der Kennung der Datei;
  - Abfragen der Freigaben und Credits des Kontos;
  - beim Wiederherstellen die Abfrage der Liste seiner Sicherungen.
- **Von Alephs Gateway, beim Wiederherstellen:** die Sicherungsdateien, neueste zuerst, höchstens 20, bis eine mit dem Passkey aufgeht.

## Technisch

- **Format:** die Anwendungssicherung `OSBA` der Storage Bridge (`@le-space/orbitdb-storage-bridge/app-backup`).
  - Der Kopf ist der Tresor-Datensatz als JSON: Version 1, AES-GCM, eine ID, der versiegelte Inhalt und die Fächer mit `kid`, `iv` und `ciphertext`.
  - Der Rumpf sind die drei Sammlungen, Block für Block (`bundleDatabases`), als eine CAR-Datei, versiegelt mit AES-GCM unter dem `backupKey` des Tresors.
  - Das Manifest darin nennt den SHA-256 des Kopfs; ein veränderter Kopf wird abgelehnt.
- **Schlüssel:** Der Tresor (Version 3) hält `backupKey` (AES-GCM) und `alephKey` (secp256k1), je 32 zufällige Bytes. Sie liegen neben Datenbankschlüssel, Datenbanknamen, Peer-Seed und dem Geheimnis der Bücher-Identität und sind für jedes Fach gleich. Entfernen macht einen neuen Tresor (`renewBooksVault`: neue ID und neuer Tresorschlüssel, neue `backupKey` und `alephKey`, ein Fach für jeden Schlüssel, der bleibt). Jeder Fachschlüssel wird vorher an seinem alten Fach geprüft. Die Adressen ausgemusterter Aleph-Schlüssel bleiben in den versiegelten Einstellungen (`backup/retired`), bis das Konto sie nicht mehr erlaubt.
- **STORE:**
  - Kanal `INVOICE-BACKUP`, `content.address` ist das zahlende Konto, `payment: { type: "credit" }`;
  - unterschrieben mit `personal_sign` vom `alephKey`;
  - das Konto gibt diesen Schlüssel in seinem `security`-Aggregat frei: nur STORE, nur dieser Kanal. Aleph berechnet das Konto, nicht den Schlüssel (gemessen am 3.10.2026).
- **Finden:**
  1. `messages.json?owners=<Konto>&channels=INVOICE-BACKUP` listet die Sicherungen (`listAlephStores`).
  2. Die Dateien kommen von `ipfs.aleph.cloud/ipfs/<cid>`.
  3. Jeder Kopf wird ohne Schlüssel gelesen.
  4. Genommen wird die erste, neueste zuerst, deren Tresor ein Fach mit `kid` = SHA-256 der Credential-ID des Passkeys hat.
- **Wiederherstellen:**
  - Der Tresor kommt nur in diesen Browser, wenn hier kein Tresor ein Fach für den Passkey hat; hat einer eines, öffnen die Bücher, wie sie sind. Geöffnet wird die Sicherung mit dem `backupKey` des Tresors vorn, gelesen mit dem Fachschlüssel des Passkeys; so geht auch eine Sicherung von vor einem Entfernen auf.
  - Ein Tresor, der kollidieren würde, wird abgelehnt: wenn hier schon ein Tresor anderer Bücher, oder ein älterer dieser, mit einem seiner Schlüssel öffnet.
  - Die Bücher öffnen unter ihren eigenen Adressen, und `restoreAppBackup` führt zusammen und lehnt fremde Bücher ab.
  - Scheitert etwas, kommt der eingespielte Tresor wieder heraus, und ein Passkey ohne Bücher hier wird nicht behalten.
- **Verlauf:** in den versiegelten Einstellungen (`backup/history`, die neuesten 50). Jeder Eintrag trägt die Fach-Kennungen des Tresors, den die Sicherung trägt; die Seite vergleicht sie mit den Fächern von jetzt.

Code: `app/src/lib/backup.js`, `books-vault.js`, `session.svelte.js`, `BackupSection.svelte`.
