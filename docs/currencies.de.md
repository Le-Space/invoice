# Währungen und Krypto-Rechnungen

_English: [currencies.md](currencies.md)_

Eine Rechnung hat eine Währung (`currency.js`). Jeder Betrag ist eine ganze Zahl ihrer kleinsten Einheit, als Zeichenkette gehalten: Cent, Satoshi, uNYM. Ether und POL werden in 10⁻⁸ berechnet, damit niemand achtzehn Nachkommastellen lesen muss; `toChainUnits` rechnet für einen Zahlungscode oder eine Buchung in Wei um.

Eine Rechnung in einer anderen Währung als Euro, die Umsatzsteuer ausweist, nennt die Steuer auch in Euro, mit Kurs, Quelle und Tag (Art. 230 MwSt-Systemrichtlinie, § 16 Abs. 6 UStG). Rechnungen aus dem Kapitel invoice01 (Euro-Cent als Zahlen) werden über `upgradeInvoice` gelesen.

Eine in Belege gebuchte Krypto-Transaktion wird mit `lineFromTransaction` zur Rechnungsposition. Auf einer Rechnung in ihrem eigenen Asset ist der Preis die Menge, auf einer Rechnung in Euro der Eurowert, den Belege gebucht hat. Die Position nennt die Menge, den Kurs mit Quelle und Tag und den Transaktions-Hash und behält alles in `line.source`. `eurRateOf` nimmt den Kurs der Buchung als Kurs der Rechnung für die Umsatzsteuer in Euro.

Eine Rechnung in einer Kryptowährung trägt statt des GiroCodes einen Zahlungscode (`payment-code.js`):

- BIP-21 für Bitcoin;
- EIP-681 für Ether, POL und USDC, mit dem Betrag in der Einheit der Chain;
- die bloße Adresse für NYM und AKT, wo sich die Wallets auf keine Zahlungs-URI geeinigt haben.

Die Adresse kommt aus den Einstellungen des Ausstellers und wird für ihre Chain geprüft; ohne sie lässt sich die Rechnung nicht ausstellen.

Eine Krypto-Rechnung nennt das Netz, auf dem sie bezahlt wird (`networks.js`): USDC und Ether gibt es auf mehreren Chains, und eine Zahlung auf der falschen kommt nicht an. Code, Adresszeile und Anschreiben sagen es. Rechnungen aus der Zeit vor den Netzen gelten als auf dem ersten Netz ihrer Währung bezahlt (Ethereum für ETH und USDC). `applyChainTemplate` richtet einen Entwurf für eine Chain ein (Währung, Nachkommastellen, Netz, übliche Positionen), und `chainTemplateText` liefert das Anschreiben dazu, auf Deutsch oder Englisch.
