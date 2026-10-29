# What comes next

_Deutsch: [roadmap.de.md](roadmap.de.md)_

## Not yet

- Pairing by QR code without any relay. The alpha module `@le-space/libp2p-webrtc-qr` exchanges WebRTC signaling as QR codes.
- Sync between one's own devices.
- `create-draft` in the UCEP extension.
- Fetching a PDF by CID over Bitswap on a relayed connection.

## Planned

- **ZUGFeRD / Factur-X:** the PDF as PDF/A-3 with the XRechnung's CII embedded ([#54](https://github.com/Le-Space/invoice/issues/54)). XRechnung itself is there ([e-invoices.md](e-invoices.md)).
- **The XRechnung over UCEP:** `get-xml`, so a paired Belege keeps the XML original ([#55](https://github.com/Le-Space/invoice/issues/55)).
- **Offers (Angebote):** a second document type, and a public copy for milestone funding ([#36](https://github.com/Le-Space/invoice/issues/36)). The funding itself belongs to escrow01 in Le-Space/simple-todo.
- **To decide:** a replication layer, several people in one company, and pinning by a relay operator ([#32](https://github.com/Le-Space/invoice/issues/32)). Until then the books stay off the network.
- **Backup and restore:** the acceptance on hardware with two real security keys ([#28](https://github.com/Le-Space/invoice/issues/28)).
