# Connections: the UCEP invoice extension

_Deutsch: [connections.de.md](connections.de.md)_

The app serves the UCEP `invoice` extension ([Le-Space/ucep-spec](https://github.com/Le-Space/ucep-spec)) through a relay. It uses the Le-Space relays, as their two wallets register them on Aleph; `VITE_RELAY_ADDRS` overrides them, and a fallback list is used when Aleph cannot be asked.

## Pairing

An app is paired by invitation (a link or a QR code) or by a six-digit code. A stranger gets `help` and nothing else.

## What a paired app may ask

- **Eigenbelege:**
  - `create-eigenbeleg` asks for one;
  - `status` returns its state;
  - `get-pdf` returns its PDF.
- **Issued invoices** (since extension 0.2.0):
  - `list-issued` lists them, with their PDFs by `get-pdf`;
  - `record-payment` reports which were paid. The list and the invoice then say bezahlt, teilweise bezahlt, offen or überfällig.
- **Output VAT** (since 0.3.0): each listed invoice also carries its net, its VAT breakdown by rate and category (`S`, `AE` reverse charge, `E` small business, …) and the customer's VAT ID. So the bookkeeping app has the output VAT without reading the PDF.

## What the relay sees

The peer id comes from the books' vault, and the grants are kept sealed. The app connects to the relay only while an app is paired, or when asked to under "Verbindungen". The relay sees the device's IP address.
