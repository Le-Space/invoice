// The scopes of the invoice extension (Le-Space/ucep-spec,
// extensions/invoice.md), apart from the provider so a page that only offers
// them does not load the provider, libp2p and the PDF code with it.

export const SCOPES = Object.freeze({
	eigenbeleg: 'invoice:eigenbeleg:create',
	read: 'invoice:document:read',
	issuedRead: 'invoice:issued:read',
	paymentRecord: 'invoice:payment:record'
});

/** Every scope, in the order the screens offer them, with its text in the catalogue. */
export const SCOPE_TEXT = Object.freeze({
	[SCOPES.eigenbeleg]: 'ucep.scopes.eigenbeleg',
	[SCOPES.read]: 'ucep.scopes.read',
	[SCOPES.issuedRead]: 'ucep.scopes.issuedRead',
	[SCOPES.paymentRecord]: 'ucep.scopes.paymentRecord'
});
