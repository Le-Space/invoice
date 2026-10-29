# Der Kern

_English: [core.md](core.md)_

Die App baut auf diesen Modulen auf ([app.de.md](app.de.md)).

`src/core/` – reine Module, ohne Netz, ohne Oberfläche, jedes mit eigener Spezifikation:

| Modul                                | Macht                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `records.js`                         | Den Rechnungsdatensatz, das Ausstellen (das ihn festschreibt), die Storno, `foldCancellations`                        |
| `numbering.js`, `series.js`          | Nummernkreise je Identität, z. B. `2026-00000-001`                                                                    |
| `currency.js`                        | Die Währungen einer Rechnung: EUR, USD, CHF, GBP, BTC, ETH, USDC, NYM, AKT, POL                                       |
| `money.js`                           | Ganzzahlige kleinste Einheiten als Zeichenketten, einmal gerundet, Summen je Steuersatz, Umsatzsteuer in Euro         |
| `customers.js`, `settings.js`        | Kundenverzeichnis und Angaben des Ausstellers                                                                         |
| `document.js`, `labels.js`           | Das Dokumentmodell, aus dem ein PDF gezeichnet wird, und die Wörter, die es braucht                                   |
| `template.js`                        | Anschreiben und Schluss aus einer Markdown-Vorlage, die dem Nutzer gehört                                             |
| `pdf.js`                             | Das PDF (pdf-lib, eingebettete DejaVu-Schrift)                                                                        |
| `girocode.js`                        | EPC069-12-GiroCode für eine SEPA-Überweisung                                                                          |
| `bip21.js`                           | BIP-21-URI für eine Bitcoin-Zahlung, mit geprüfter Adress-Prüfsumme                                                   |
| `eip681.js`                          | EIP-681-URI für Ether oder einen ERC-20-Token auf jeder EVM-Chain, EIP-55-Prüfsumme                                   |
| `crypto-lines.js`                    | Rechnungspositionen aus Krypto-Transaktionen, wie Belege sie bucht, mit ihrer Quelle an der Position                  |
| `payment-code.js`                    | Der Code einer Krypto-Rechnung: BIP-21, EIP-681 (ETH, POL, USDC) oder die Adresse (NYM, AKT)                          |
| `networks.js`                        | Die Chains, auf denen eine Krypto-Rechnung bezahlt wird, mit Beleges Chain-IDs und USDC-Verträgen                     |
| `chain-templates.js`                 | Vorlagen je Chain: Währung, Netz, übliche Positionen und ein Anschreiben (NYM, AKT, BTC, ETH, USDC auf Base)          |
| `eigenbeleg.js`, `eigenbeleg-pdf.js` | Eigenbelege für UCEP `create-eigenbeleg`: geprüfte Angaben, ein eigener Nummernkreis, das PDF                         |
| `payments.js`                        | Gemeldete Zahlungen zu einer ausgestellten Rechnung (UCEP `record-payment`): nach Referenz, Teilzahlungen, Fälligkeit |
| `duplicates.js`                      | Eine Nummer auf zwei Rechnungen wird gemeldet, nicht umnummeriert                                                     |
| `xrechnung-rules.js`                 | Was eine XRechnung braucht, vor dem Ausstellen geprüft: BR-DE-Pflichtangaben, elektronische Adressen                  |
| `xrechnung.js`                       | Eine ausgestellte Rechnung als XRechnung (UN/CEFACT CII, XRechnung 3.0); ein Storno als Credit Note 381               |

`src/i18n/` – die deutschen und englischen Wörter der gedruckten Rechnung.
