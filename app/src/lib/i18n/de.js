// The app's words. The printed invoice's words are the core's
// (@le-space/invoice/i18n/de.json, `invoice.*`); `invoice.app` here adds
// what only the screens say.
export default {
	app: {
		name: 'Rechnungen',
		tagline: 'Rechnungen in Euro und Krypto, verschlüsselt auf deinem Gerät',
		nav: { invoices: 'Rechnungen', settings: 'Einstellungen' },
		lock: 'Sperren'
	},
	onboarding: {
		title: 'Deine Rechnungen aufschließen',
		intro:
			'Deine Rechnungen bleiben auf diesem Gerät und werden mit einem Schlüssel aus deinem Passkey verschlüsselt. Ohne den Passkey kann niemand sie lesen – auch wir nicht.',
		unlock: 'Mit gespeichertem Passkey entsperren',
		newHeading: 'Neu hier',
		label: 'Name für den Passkey',
		labelPlaceholder: 'z. B. Firma Mustermann',
		labelHint:
			'Nur eine Beschriftung in der Passkey-Auswahl. Die Identität kommt aus dem Schlüssel, nicht aus diesem Namen.',
		create: 'Passkey anlegen',
		restoreHeading: 'Schon einen Passkey?',
		restore: 'Mit vorhandenem Passkey wiederherstellen',
		busy: 'Bitte den Passkey bestätigen …',
		createFailed: 'Der Passkey konnte nicht angelegt werden.',
		restoreFailed: 'Auf diesem Gerät wurde kein Passkey für die Rechnungs-App gefunden.',
		unlockFailed: 'In diesem Browser ist kein Passkey gespeichert.'
	},
	invoice: {
		app: {
			list: {
				heading: 'Rechnungen',
				empty: 'Noch keine Rechnung. Leg die erste an.',
				new: 'Neue Rechnung',
				fromTemplate: 'Vorlage',
				noTemplate: 'Ohne Vorlage (Euro)',
				draft: 'Entwurf',
				issued: 'Ausgestellt',
				cancelled: 'Storniert',
				customer: 'Kunde',
				date: 'Datum',
				amount: 'Betrag',
				state: 'Stand'
			},
			editor: {
				back: '← Alle Rechnungen',
				draftHeading: 'Entwurf',
				issuedHeading: 'Rechnung {number}',
				currency: 'Währung',
				network: 'Netzwerk',
				rateHeading: 'Kurs für die USt. in Euro',
				rateHint:
					'Eine Rechnung in einer anderen Währung als Euro gibt die USt. auch in Euro an – zum Kurs aus dem Monat der Leistung.',
				ratePerUnit: 'Euro je {currency}',
				rateSource: 'Quelle',
				rateDate: 'Tag des Kurses',
				linePrice: 'Einzelpreis netto ({currency})',
				unreadablePrice: 'Kein Preis in {currency}',
				problems: 'Vor dem Ausstellen fehlt noch:',
				warnings: 'Bitte prüfen:',
				saved: 'Gespeichert',
				issue: 'Ausstellen',
				issueConfirm:
					'Ausstellen vergibt die Nummer und friert die Rechnung ein. Danach lässt sie sich nur noch stornieren.',
				pdf: 'PDF herunterladen',
				cancel: 'Stornieren',
				cancelled: 'Storniert durch {number}',
				totals: 'Summe',
				due: 'Zu zahlen'
			},
			settings: {
				heading: 'Einstellungen',
				issuer: 'Aussteller',
				name: 'Name',
				address: 'Anschrift',
				vatId: 'USt-IdNr.',
				taxNumber: 'Steuernummer',
				email: 'E-Mail',
				phone: 'Telefon',
				web: 'Webseite',
				bank: 'Bank',
				bankName: 'Name der Bank',
				iban: 'IBAN',
				bic: 'BIC',
				crypto: 'Adressen für Krypto-Zahlungen',
				cryptoHint:
					'An diese Adressen wird eine Krypto-Rechnung gezahlt. Die Ethereum-Adresse gilt auch für POL und USDC, auf jeder EVM-Chain.',
				btc: 'Bitcoin',
				eth: 'Ethereum / EVM',
				nym: 'NYM (Nyx)',
				akt: 'Akash',
				invalidAddress: 'Keine gültige Adresse für dieses Netzwerk',
				defaults: 'Voreinstellungen',
				taxMode: 'Besteuerung',
				paymentTerms: 'Zahlungsziel (Tage)',
				series: 'Nummernkreis dieses Passkeys',
				save: 'Speichern',
				saved: 'Gespeichert'
			},
			taxModes: {
				standard: 'Regelbesteuerung',
				kleinunternehmer: 'Kleinunternehmer (§ 19 UStG)',
				'reverse-charge': 'Reverse Charge (§ 13b UStG)'
			}
		}
	}
};
