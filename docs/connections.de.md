# Verbindungen: die UCEP-Rechnungserweiterung

_English: [connections.md](connections.md)_

Die App bietet die UCEP-Erweiterung `invoice` an ([Le-Space/ucep-spec](https://github.com/Le-Space/ucep-spec)), über einen Relay. Sie nutzt die Le-Space-Relays, so wie ihre beiden Wallets sie bei Aleph eintragen; `VITE_RELAY_ADDRS` ersetzt sie, und eine Ersatzliste greift, wenn Aleph nicht zu erreichen ist.

## Koppeln

Eine App wird per Einladung gekoppelt (ein Link oder ein QR-Code) oder mit einem sechsstelligen Code. Ein Fremder bekommt `help` und sonst nichts.

## Was eine gekoppelte App fragen darf

- **Eigenbelege:**
  - `create-eigenbeleg` bestellt einen;
  - `status` liefert seinen Stand;
  - `get-pdf` liefert sein PDF.
- **Ausgestellte Rechnungen** (seit Erweiterung 0.2.0):
  - `list-issued` listet sie, mit ihren PDFs über `get-pdf`;
  - `record-payment` meldet, welche bezahlt wurden. Liste und Rechnung sagen dann bezahlt, teilweise bezahlt, offen oder überfällig.
- **Umsatzsteuer** (seit 0.3.0): Jede gelistete Rechnung trägt außerdem ihren Nettobetrag, ihre Aufschlüsselung der Umsatzsteuer nach Satz und Kategorie (`S`, `AE` Reverse Charge, `E` Kleinunternehmer, …) und die USt-IdNr. des Kunden. So hat die Buchhaltungs-App die Umsatzsteuer, ohne das PDF zu lesen.

## Was der Relay sieht

Die Peer-ID kommt aus dem Tresor der Bücher, und die Freigaben liegen versiegelt. Die App verbindet sich nur mit dem Relay, solange eine App gekoppelt ist oder unter „Verbindungen“ darum gebeten wird. Der Relay sieht die IP-Adresse des Geräts.
