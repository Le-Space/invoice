# Was als Nächstes kommt

_English: [roadmap.md](roadmap.md)_

## Noch nicht

- Koppeln per QR-Code ganz ohne Relay. Das Alpha-Modul `@le-space/libp2p-webrtc-qr` tauscht die WebRTC-Signale als QR-Codes aus.
- Abgleich zwischen den eigenen Geräten.
- `create-draft` in der UCEP-Erweiterung.
- Ein PDF per CID über Bitswap auf einer weitergeleiteten Verbindung holen.

## Geplant

- **ZUGFeRD / Factur-X:** das PDF als PDF/A-3 mit dem CII der XRechnung darin ([#54](https://github.com/Le-Space/invoice/issues/54)). Die XRechnung selbst gibt es ([e-invoices.de.md](e-invoices.de.md)).
- **Angebote:** ein zweiter Dokumenttyp, und eine öffentliche Kopie für die Finanzierung nach Meilensteinen ([#36](https://github.com/Le-Space/invoice/issues/36)). Die Finanzierung selbst gehört zu escrow01 in Le-Space/simple-todo.
- **Zu entscheiden:** eine Replikationsschicht, mehrere Personen in einer Firma, und das Vorhalten durch einen Relay-Betreiber ([#32](https://github.com/Le-Space/invoice/issues/32)). Bis dahin bleiben die Bücher vom Netz.
- **Sicherung und Wiederherstellen:** die Abnahme auf Hardware mit zwei echten Sicherheitsschlüsseln ([#28](https://github.com/Le-Space/invoice/issues/28)).
