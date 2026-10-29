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
- **XRechnung** (seit 0.4.0): `get-xml` liefert das XML einer ausgestellten Rechnung, deren Kunde eine XRechnung bekommt ([e-invoices.de.md](e-invoices.de.md)), und `list-issued` nennt zu jeder Rechnung ihre Dateien (`"formats": ["pdf", "xrechnung"]`). So kann eine Buchhaltungs-App wie Belege das XML als Original behalten.
  - `invoice:issued:read` öffnet es, so wie die PDFs. Das XML enthält außerdem die E-Mail-Adresse und die Käuferreferenz des Kunden, die das PDF nicht druckt.
  - Es kommt auch über den Relay: Eine XRechnung unter 44 KiB passt in die 64 KiB, die eine Antwort über den Relay wiegen darf. Ein PDF kommt nur über eine direkte Verbindung.

## Was der Relay sieht

Die Peer-ID kommt aus dem Tresor der Bücher, und die Freigaben liegen versiegelt. Die App verbindet sich nur mit dem Relay, solange eine App gekoppelt ist oder unter „Verbindungen“ darum gebeten wird. Der Relay sieht die IP-Adresse des Geräts.
