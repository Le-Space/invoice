# Was als Nächstes kommt

_English: [roadmap.md](roadmap.md)_

## Noch nicht

- Koppeln per QR-Code ganz ohne Relay. Das Alpha-Modul `@le-space/libp2p-webrtc-qr` tauscht die WebRTC-Signale als QR-Codes aus.
- Abgleich zwischen den eigenen Geräten.
- `create-draft` in der UCEP-Erweiterung.
- Ein PDF per CID über Bitswap auf einer weitergeleiteten Verbindung holen.

## Geplant

- **E-Rechnungen:** XRechnung und ZUGFeRD (EN 16931), mit KoSIT geprüft ([#19](https://github.com/Le-Space/invoice/issues/19)).
- **Angebote:** ein zweiter Dokumenttyp, und eine öffentliche Kopie für die Finanzierung nach Meilensteinen ([#36](https://github.com/Le-Space/invoice/issues/36)). Die Finanzierung selbst gehört zu escrow01 in Le-Space/simple-todo.
- **Zu entscheiden:** eine Replikationsschicht, mehrere Personen in einer Firma, und das Vorhalten durch einen Relay-Betreiber ([#32](https://github.com/Le-Space/invoice/issues/32)). Bis dahin bleiben die Bücher vom Netz.
- **Sicherung und Wiederherstellen:** die Abnahme auf Hardware mit zwei echten Sicherheitsschlüsseln ([#28](https://github.com/Le-Space/invoice/issues/28)).
