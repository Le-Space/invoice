# Currencies and crypto invoices

_Deutsch: [currencies.de.md](currencies.de.md)_

An invoice has a currency (`currency.js`). Every amount is an integer of its
smallest unit on the invoice, kept as a string: cents, satoshi, uNYM. Ether and
POL are invoiced in 10⁻⁸, so nobody has to read eighteen decimals;
`toChainUnits` scales to wei for a payment code or a booking.

An invoice in another currency than euros that shows VAT also states the VAT
in euros, with the rate, its source and its day (Art. 230 VAT Directive, §16
Abs. 6 UStG). Invoices written by the invoice01 chapter (euro cents in numbers)
are read through `upgradeInvoice`.

A crypto transaction booked in Belege becomes an invoice line with
`lineFromTransaction`: on an invoice in its own asset the price is the quantity,
on an invoice in euros the euro value Belege booked. The line says the quantity,
the rate with its source and day, and the transaction hash, and keeps all of it
in `line.source`. `eurRateOf` takes the booking's rate as the invoice's rate for
the VAT in euros.

An invoice in a crypto currency carries a code instead of the GiroCode
(`payment-code.js`): BIP-21 for Bitcoin, EIP-681 for Ether, POL and USDC with
the amount in the chain's unit, and the address alone for NYM and AKT, where
wallets agree on no payment URI. The address comes from the issuer's settings
and is checked for its chain; an invoice without one cannot be issued.

A crypto invoice names the network it is paid on (`networks.js`): USDC and
Ether exist on several chains, and a payment on the wrong one does not arrive.
The code, the address line and the letter say it. Invoices from before networks
are read as paid on the first network of their currency (Ethereum for ETH and
USDC). `applyChainTemplate` sets a draft up for a chain — currency, decimals,
network, the usual lines — and `chainTemplateText` gives the letter to issue
it with, in German or English.
