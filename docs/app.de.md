# Die App

_English: [app.md](app.md)_

`app/` ist eine PWA (SvelteKit 2, Svelte 5) auf dem Kern ([core.de.md](core.de.md)). Sie hat drei Seiten:

- **Rechnungen:**
  - eine Liste und ein Entwurfseditor (Kunde, Daten, Steuerart, Währung und Netz, der Eurokurs für die Umsatzsteuer, Positionen);
  - das Ausstellen mit der nächsten Nummer aus dem Kreis dieses Passkeys;
  - das PDF und eine Storno.

  Eine neue Rechnung kann mit einer Chain-Vorlage beginnen (NYM, AKT, BTC, ETH, USDC auf Base).

- **Einstellungen:**
  - Aussteller und Bank;
  - die Krypto-Adressen, für ihr Netz geprüft;
  - die Einheiten für Positionen;
  - die übliche Steuerart und die Zahlungsbedingungen;
  - die Schlüssel und die Sicherung (unten).
- **Verbindungen:** über UCEP gekoppelte Apps ([connections.de.md](connections.de.md)).

## Passkeys und der Tresor der Bücher

Ein Passkey öffnet die App. Seine PRF-Antwort öffnet den Tresor der Bücher, und darin liegen:

- der Schlüssel, mit dem jede OrbitDB-Datenbank versiegelt ist;
- die Namen der Datenbanken;
- der Seed des UCEP-Peers;
- das Geheimnis der eigenen Identität der Bücher.

Die Bücher unterschreiben als diese Identität, und sie ist die Wurzel der Zugriffssteuerung jeder Sammlung. Darum schreibt jeder Passkey mit einem Fach im Tresor als die Bücher; die DID des Passkeys steht in jedem Datensatz als `author`. Bücher von vorher sind einmal in Datenbanken umgezogen, deren Wurzel diese Identität ist; die alten bleiben, nur lesbar.

## Ein zweiter Schlüssel

Unter Einstellungen → Schlüssel bekommt ein zweiter Passkey ein eigenes Fach, etwa ein YubiKey. Ein Schlüssel lässt sich entfernen, aber nie der letzte und nie der, mit dem gerade entsperrt ist; auch einer, den dieser Browser nicht hinterlegt hat, wie meist ein verlorener. Ein entfernter Schlüssel öffnet in diesem Browser nichts mehr.

Entfernen erneuert den Tresor: neue Tresor-, Datei- und Sicherungsschlüssel und ein Fach für jeden Schlüssel, der bleibt. Jeder, der bleibt, außer dem, mit dem entsperrt ist, wird einmal gefragt, und das zahlende Konto muss den neuen Sicherungsschlüssel freigeben ([backup.de.md](backup.de.md#einen-schlüssel-entfernen)).

## Sicherung und Wiederherstellen

Unter Einstellungen → Sicherung gehen die Bücher als eine versiegelte Datei mit dem Tresor vorn zu Aleph Cloud, direkt aus dem Browser. Ein Schlüssel aus dem Tresor unterschreibt die STORE-Nachricht, die sie aufbewahren lässt, für ein zahlendes Konto, das diesen Schlüssel einmal freigegeben hat (das Konto der belege-Bridge, `pnpm setup:aleph -- --authorize`).

- **Welcher Passkey eine Sicherung öffnet:** Jeder eingetragene Passkey kann eine machen, aber öffnen können sie nur die Passkeys, die beim Sichern eingetragen waren. Ein später hinzugefügter Schlüssel braucht eine neue Sicherung, und bis dahin nennt ihn die Seite.
- **Auf einem leeren Gerät** braucht „Bücher aus einer Sicherung holen“ zwei Dinge:
  - die Adresse des zahlenden Kontos, die öffentlich ist, aber der einzige Weg zu den Sicherungen;
  - einen Passkey, der beim Sichern eingetragen war.

  Die neueste Sicherung mit einem Fach für diesen Passkey kommt zurück und wird mit den Büchern zusammengeführt.

- **Ein Passkey ohne Bücher hier:** Die App fragt, bevor sie leere Bücher anlegt.
- **Ein entfernter Schlüssel** öffnet keine neue Sicherung mehr, die von vor seinem Entfernen aber weiter.

Alles dazu: [backup.de.md](backup.de.md).

## Was wo liegt

Auf der Festplatte ist nichts lesbar, und kein privater Schlüssel wird gespeichert (`app/src/lib/node.js`, `books-vault.js`, `books-move.js`, `session-identities.js`, `backup.js`). Die Bücher bleiben vom Netz: OrbitDB und Helia laufen auf einem Knoten ohne Netz (`app/src/lib/network.js`), und der UCEP-Knoten, der einzige, der über einen Relay geht, trägt keine Datenbank.

Die Sitzungs- und Speicherschicht kommt aus Le-Space/belege, wo ihr Autor sie geschrieben hat, und steht hier unter MIT.
