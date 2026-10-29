# E-Rechnungen: XRechnung

_English: [e-invoices.md](e-invoices.md)_

Eine Rechnung kann neben ihrem PDF als **XRechnung** hinausgehen:

- das Format ist UN/CEFACT CII (D16B), CIUS XRechnung 3.0, EN 16931;
- in der CI geht jede erfundene Testrechnung durch den **KoSIT-Validator** mit der XRechnung-Konfiguration;
- in der App werden die Pflichtangaben vor dem Ausstellen geprüft.

Was es noch nicht gibt:

- ZUGFeRD / Factur-X, das PDF mit eingebettetem XML ([#54](https://github.com/Le-Space/invoice/issues/54));
- das XML über UCEP holen ([#55](https://github.com/Le-Space/invoice/issues/55));
- der Versand über Peppol oder an Behördenportale.

## In der App

1. **Einstellungen → Für die XRechnung:**
   - der Ansprechpartner (BT-41);
   - PLZ, Ort und Land (ISO 3166-1, z. B. `DE`) des Ausstellers.

   Telefon, E-Mail, USt-IdNr. oder Steuernummer und IBAN sind die von oben. PLZ und Ort werden aus einer Zeile „12345 Musterstadt“ der Anschrift übernommen, wo es eine gibt.

2. **Ein Entwurf → Rechnungsformat → „PDF und XRechnung“:**
   - die Käuferreferenz des Kunden (BT-10). XRechnung verlangt sie auf jeder Rechnung; bei einer Behörde ist es die Leitweg-ID.
   - eine E-Mail-Adresse für Rechnungen (BT-49);
   - PLZ, Ort und Land.
3. **Bis alles da ist**, nennt der Entwurf, was fehlt, und „Ausstellen“ bleibt aus.
4. **Eine ausgestellte Rechnung** bietet neben dem PDF „XRechnung herunterladen“ an.

**Die Anschrift bleibt der Freitext, den das PDF druckt.** PLZ, Ort und Land stehen daneben, und die Prüfung lehnt eine PLZ oder einen Ort ab, die im Freitext nicht stehen. So können PDF und XML nicht zwei Orte nennen.

Das Format gehört zum Kunden der Rechnung, und ein Storno behält es. Rechnungen, die vorher ausgestellt wurden, haben die neuen Felder nicht; sie haben keine XRechnung und bleiben gültige PDFs.

## Was die App prüft und was KoSIT prüft

KoSIT ist die Referenz: Es ist die Prüfung, die das Portal eines Empfängers fährt. KoSIT braucht Java und läuft deshalb nicht in dieser App. Die App prüft stattdessen vor dem Ausstellen, wofür KoSIT die Rechnung ablehnen würde (`src/core/xrechnung-rules.js`):

| Regel                          | Was                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| BR-DE-5, -6, -7                | Ansprechpartner, Telefon (mindestens drei Ziffern, BR-DE-27) und E-Mail des Verkäufers                                                     |
| PEPPOL-EN16931-R020, R010      | Die elektronische Adresse von Verkäufer und Käufer; die des Verkäufers ist seine E-Mail. KoSIT übernimmt diese Peppol-Regeln in XRechnung. |
| BR-DE-3, -4, -8, -9; BR-9, -11 | PLZ, Ort und Land von beiden, jeweils für sich                                                                                             |
| BR-DE-15                       | Die Käuferreferenz                                                                                                                         |
| BR-DE-16; BR-AE-02             | Eine USt-IdNr. oder eine Steuernummer; bei Reverse-Charge die USt-IdNr.                                                                    |
| BR-DE-1, -23                   | Die IBAN, außer bei einem Storno                                                                                                           |
| BR-CL-04                       | Eine Währung mit ISO-4217-Code: EUR, USD, CHF, GBP. Eine Krypto-Rechnung hat keine XRechnung.                                              |
| BR-27                          | Kein negativer Preis. Ein Nachlass ist eine Position mit negativer Menge.                                                                  |

`scripts/kosit.sh` lässt KoSIT über die Testrechnungen in `scripts/xrechnung-fixtures.js` laufen:

- 19 %, 7 % mit einem Nachlass und 0 %;
- Reverse-Charge nach Österreich und ein Kleinunternehmer nach § 19 UStG;
- ein Storno;
- eine Behörde mit Leitweg-ID;
- eine Rechnung in US-Dollar mit der USt. in Euro.

Das Skript lädt den Validator (1.6.3) und die Konfiguration (Release 2026-08-31, XRechnung 3.0.2), beide per SHA-256 festgelegt. Es schlägt fehl, wenn KoSIT eine Testrechnung nicht annimmt. Lokal, mit Java 11 oder neuer:

```bash
pnpm xrechnung:validate
```

## Wie das XML entsteht

`src/core/xrechnung.js` schreibt das XML aus dem ausgestellten Datensatz. Es nimmt dasselbe `computeTotals` wie das PDF, und ein Spec liest die Summen zurück.

- **Storno:** eine Credit Note (Typcode 381, in der XRechnung „Gutschrift“ genannt, aber keine Gutschrift nach § 14 Abs. 2 UStG). Die Mengen sind wieder positiv, sie nennt die stornierte Rechnung (BT-25), und ihr Zahlungsweg ist „nicht festgelegt“, weil sie nichts einzieht.
- **Besteuerung:** Reverse-Charge ist Kategorie AE mit `VATEX-EU-AE`, § 19 UStG ist Kategorie E. Beide nennen ihren Grund (BT-120).
- **Zahlung:** Eine Rechnung in Euro wird per SEPA-Überweisung (58) bezahlt, eine in anderer Währung per Überweisung (30), beide an die IBAN.
- **Andere Währung:** Sie nennt ihre USt. auch in Euro (BT-6, BT-111), zum Kurs auf der Rechnung.
- **Einheiten:** Sie gehen als Codes nach UN/ECE-Empfehlung 20 hinaus: Stück H87, Stunde HUR, Tag DAY, Monat MON, Pauschale LS. Eine von Hand getippte Einheit, die nicht bekannt ist, geht als C62 („Eins“) hinaus.
