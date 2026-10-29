# E-invoices: XRechnung

_Deutsch: [e-invoices.de.md](e-invoices.de.md)_

An invoice can go out as an **XRechnung**, beside its PDF:

- the format is UN/CEFACT CII (D16B), CIUS XRechnung 3.0, EN 16931;
- in CI, every made-up fixture goes through the **KoSIT validator** with the XRechnung configuration;
- in the app, the mandatory fields are checked before the invoice is issued.

What is not here yet:

- ZUGFeRD / Factur-X, the PDF with the XML embedded ([#54](https://github.com/Le-Space/invoice/issues/54));
- sending by Peppol or to public portals.

## In the app

1. **Einstellungen → Für die XRechnung:**
   - the contact person (BT-41);
   - the post code, city and country (ISO 3166-1, e.g. `DE`) of the issuer.

   The phone, the e-mail, the VAT id or tax number and the IBAN are the ones above. Post code and city are taken from a "12345 Musterstadt" line of the address where there is one.

2. **A draft → Rechnungsformat → "PDF und XRechnung":**
   - the customer's buyer reference (BT-10). XRechnung wants it on every invoice; for a public body it is the Leitweg-ID.
   - an e-mail address for invoices (BT-49);
   - post code, city and country.
3. **Until it is all there**, the draft lists what is missing, and "Ausstellen" stays off.
4. **An issued invoice** offers "XRechnung herunterladen" beside the PDF.
5. **A paired app** such as Belege can fetch the XML over UCEP with `get-xml` and keep it as the original ([connections.md](connections.md)).

**The address stays the free text the PDF prints.** Post code, city and country are kept beside it, and the check refuses a post code or city that the free text does not name. So the PDF and the XML cannot name two places.

The format is kept with the invoice's customer, and a Storno keeps it. Invoices issued before this lack the new fields, so they have no XRechnung; they stay valid PDFs.

## What the app checks, and what KoSIT checks

KoSIT is the reference: it is the check a recipient's portal runs. It needs Java, so it cannot run in this app. Instead, the app checks before issuing what KoSIT would reject the invoice for (`src/core/xrechnung-rules.js`):

| Rule                           | What                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| BR-DE-5, -6, -7                | The seller's contact name, phone (at least three digits, BR-DE-27) and e-mail                                                |
| PEPPOL-EN16931-R020, R010      | The seller's and the buyer's electronic address. The seller's is its e-mail. KoSIT merges these Peppol rules into XRechnung. |
| BR-DE-3, -4, -8, -9; BR-9, -11 | Post code, city and country of both, each on its own                                                                         |
| BR-DE-15                       | The buyer reference                                                                                                          |
| BR-DE-16; BR-AE-02             | A VAT id or a tax number; for reverse charge, the VAT id                                                                     |
| BR-DE-1, -23                   | The IBAN, except on a Storno                                                                                                 |
| BR-CL-04                       | A currency with an ISO 4217 code: EUR, USD, CHF, GBP. A crypto invoice has no XRechnung.                                     |
| BR-27                          | No negative price. A discount is a line with a negative quantity.                                                            |

`scripts/kosit.sh` runs KoSIT over the fixtures in `scripts/xrechnung-fixtures.js`:

- 19 %, 7 % with a discount line, and 0 %;
- reverse charge to Austria, and a small business under § 19 UStG;
- a Storno;
- a public body with a Leitweg-ID;
- an invoice in US dollars with its VAT in euros.

It downloads the validator (1.6.3) and the configuration (release 2026-08-31, XRechnung 3.0.2), both pinned by SHA-256. It fails when KoSIT does not accept a fixture. Locally, with Java 11 or later:

```bash
pnpm xrechnung:validate
```

## How the XML is made

`src/core/xrechnung.js` writes the XML from the issued record. It uses the same `computeTotals` as the PDF, and a spec reads the totals back.

- **Storno:** a credit note (type code 381). The quantities are positive again, it names the invoice it cancels (BT-25), and its payment means is "not defined", since it pays nothing in.
- **Tax modes:** reverse charge is category AE with `VATEX-EU-AE`; § 19 UStG is category E. Both give their reason (BT-120).
- **Payment:** a euro invoice is paid by SEPA credit transfer (58), another currency by credit transfer (30), both to the IBAN.
- **Another currency:** it states its VAT in euros too (BT-6, BT-111), at the rate on the invoice.
- **Units:** they go out as UN/ECE Recommendation 20 codes: Stück H87, Stunde HUR, Tag DAY, Monat MON, Pauschale LS. A unit typed by hand that is not known goes out as C62 ("one").
