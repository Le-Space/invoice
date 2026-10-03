// The move, against a real OrbitDB and Helia in Node: books written the way the
// app wrote them until now — a passkey's identity, OrbitDB's default access
// controller — move to databases rooted at the books' own identity.
//
// What has to hold for books that exist: the old addresses are found again
// (the same write list gives the same address), every record arrives as it
// left, deleted ones included, nothing can write to the old databases any more,
// and running the move twice changes nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHeliaLight } from 'helia';
import { withLibp2p } from '@helia/libp2p';
import { withBitswap } from '@helia/bitswap';
import {
	IPFSAccessController,
	MemoryStorage,
	createOrbitDB,
	useIdentityProvider
} from '@orbitdb/core';
import * as dagCbor from '@ipld/dag-cbor';
import {
	OrbitDBWebAuthnIdentityProviderFunction,
	createSecretSigner
} from '@le-space/orbitdb-identity-provider-webauthn-did';

import { createOfflineLibp2p } from './network.js';
import { deriveDatabaseKey, deriveDatabaseName } from './database-keys.js';
import { payloadEncryption } from './entry-encryption.js';
import { BOOKS_IDENTITY_INFO, createBooksIdentities } from './session-identities.js';
import { MOVE_RECORD_KEY, booksAccessController, moveBooks } from './books-move.js';
import { openStore } from './store/repository.js';
import SealedDocuments from './store/sealed-documents.js';

const prfOutput = crypto.getRandomValues(new Uint8Array(32));
const COLLECTIONS = /** @type {const} */ (['invoices', 'customers', 'settings']);

/** @type {any} */ let helia;
/** @type {string} */ let directory;
/** @type {Uint8Array} */ let encryptionKey;
/** @type {Record<string, string>} */ let names;

/**
 * Heads and index per database, kept across OrbitDB instances the way IndexedDB
 * keeps them across reloads; entries live in Helia's blockstore anyway.
 *
 * @type {Map<string, { headsStorage: any, indexStorage: any }>}
 */
const kept = new Map();
/** @param {string} key */
async function storagesFor(key) {
	if (!kept.has(key)) {
		kept.set(key, { headsStorage: await MemoryStorage(), indexStorage: await MemoryStorage() });
	}
	return /** @type {{ headsStorage: any, indexStorage: any }} */ (kept.get(key));
}

/** An OrbitDB instance signing as `signer`, as the app builds one. */
async function orbitAs(/** @type {any} */ signer) {
	const identities = await createBooksIdentities(helia, signer);
	const identity = await identities.createIdentity({
		provider: OrbitDBWebAuthnIdentityProviderFunction({ signer })
	});
	// @ts-expect-error `identities` is a documented option the bundled types omit
	return createOrbitDB({ ipfs: helia, identities, identity, directory });
}

beforeAll(async () => {
	try {
		useIdentityProvider(OrbitDBWebAuthnIdentityProviderFunction);
	} catch {
		// registered by another spec in this worker
	}
	helia = await withBitswap(
		withLibp2p(createHeliaLight({ codecs: [dagCbor] }), await createOfflineLibp2p())
	).start();
	directory = await mkdtemp(join(tmpdir(), 'invoice-books-move-'));
	encryptionKey = await deriveDatabaseKey(prfOutput);
	names = {};
	for (const c of COLLECTIONS) names[c] = await deriveDatabaseName(prfOutput, c);
});

afterAll(async () => {
	await helia?.stop();
	if (directory) await rm(directory, { recursive: true, force: true });
});

describe('moving the books to their own identity', () => {
	it('finds the old books, copies every record as it was, and leaves the old ones unwritable', async () => {
		// The passkey that made the books: here a signer with its own DID, which
		// is all an access controller looks at.
		const person = await createSecretSigner(new Uint8Array(32).fill(1), { info: 'test/person/v1' });
		const books = await createSecretSigner(new Uint8Array(32).fill(2), {
			info: BOOKS_IDENTITY_INFO
		});

		// Books as the app wrote them until now.
		const personOrbit = await orbitAs(person);
		const old = await openStore({
			orbitdb: personOrbit,
			encryptionKey,
			names: /** @type {any} */ (names),
			openOptions: (/** @type {string} */ name) => storagesFor(`old:${name}`)
		});
		const customer = await old.customers.put({ name: 'Wolkenfabrik Hosting GmbH' });
		const invoice = await old.invoices.put({
			number: '2026-12345-001',
			customerId: customer.id,
			totalCents: 119000
		});
		await old.invoices.put({ ...invoice, status: 'issued' });
		const dropped = await old.invoices.put({ number: '2026-12345-002', totalCents: 500 });
		await old.invoices.softDelete(dropped.id);
		await old.settings.put({ key: 'invoice', value: { taxMode: 'standard' } });
		/** @type {Record<string, any[]>} */ const before = {};
		/** @type {Record<string, string>} */ const oldAddresses = {};
		for (const c of COLLECTIONS) {
			before[c] = await old[c].list({ includeDeleted: true });
			oldAddresses[c] = old[c].address;
		}
		await old.close();
		await personOrbit.stop();

		// The next unlock: an OrbitDB that signs as the books.
		const booksOrbit = await orbitAs(books);
		const openOptions = async (/** @type {string} */ name, /** @type {string} */ side) =>
			storagesFor(`${side}:${name}`);
		const moved = await moveBooks({
			orbitdb: booksOrbit,
			names,
			encryptionKey,
			formerWriter: person.did,
			openOptions
		});

		expect(moved.from).toEqual(oldAddresses);
		for (const c of COLLECTIONS) expect(moved.to[c]).not.toBe(oldAddresses[c]);
		expect(moved.records).toEqual({ invoices: 2, customers: 1, settings: 1 });
		expect(moved.copied).toEqual(moved.records);

		// Interrupted before the switch and run again: nothing is copied twice.
		const again = await moveBooks({
			orbitdb: booksOrbit,
			names,
			encryptionKey,
			formerWriter: person.did,
			openOptions
		});
		expect(again.copied).toEqual({ invoices: 0, customers: 0, settings: 0 });
		expect(again.to).toEqual(moved.to);

		const store = await openStore({
			orbitdb: booksOrbit,
			encryptionKey,
			names: /** @type {any} */ (names),
			author: person.did,
			accessController: booksAccessController(books.did),
			openOptions: (/** @type {string} */ name) => storagesFor(`new:${name}`)
		});
		try {
			for (const c of COLLECTIONS) {
				expect(store[c].address).toBe(moved.to[c]);
				expect(await store[c].list({ includeDeleted: true })).toEqual(before[c]);
			}
			// Written from now on: by the books' identity, with the person as author.
			const next = await store.invoices.put({ number: '2026-12345-003', totalCents: 100 });
			expect(next.author).toBe(person.did);
		} finally {
			await store.close();
		}

		// Once the books are in use at their new place, a move would find more
		// there than it brought, and refuses rather than calling that complete.
		await expect(
			moveBooks({
				orbitdb: booksOrbit,
				names,
				encryptionKey,
				formerWriter: person.did,
				openOptions
			})
		).rejects.toThrow(/3 records arrived for 2/);

		// The old collection: the books' identity is not in its write list.
		const oldInvoices = await booksOrbit.open(names.invoices, {
			type: SealedDocuments.type,
			Database: SealedDocuments({ indexBy: 'id' }),
			encryption: await payloadEncryption(encryptionKey),
			AccessController: IPFSAccessController({ write: [person.did] }),
			...(await storagesFor('old:invoices'))
		});
		try {
			expect(oldInvoices.address.toString()).toBe(oldAddresses.invoices);
			await expect(
				oldInvoices.put({ id: 'not-allowed', number: 'x', totalCents: 0 })
			).rejects.toThrow(/not allowed to write/);
		} finally {
			await oldInvoices.close();
			await booksOrbit.stop();
		}
	});

	it('moves empty books too, and the record of the move does not count as books', async () => {
		const person = await createSecretSigner(new Uint8Array(32).fill(3), { info: 'test/person/v1' });
		const books = await createSecretSigner(new Uint8Array(32).fill(4), {
			info: BOOKS_IDENTITY_INFO
		});
		/** @type {Record<string, string>} */ const fresh = {};
		for (const c of COLLECTIONS) fresh[c] = `${names[c]}-fresh`;
		const booksOrbit = await orbitAs(books);
		const openOptions = async (/** @type {string} */ name, /** @type {string} */ side) =>
			storagesFor(`fresh-${side}:${name}`);
		try {
			const moved = await moveBooks({
				orbitdb: booksOrbit,
				names: fresh,
				encryptionKey,
				formerWriter: person.did,
				openOptions
			});
			expect(moved.records).toEqual({ invoices: 0, customers: 0, settings: 0 });

			// The app writes the record of the move into the new settings; a move
			// run again after that still finds the books complete.
			const store = await openStore({
				orbitdb: booksOrbit,
				encryptionKey,
				names: /** @type {any} */ (fresh),
				author: person.did,
				accessController: booksAccessController(books.did),
				openOptions: (/** @type {string} */ name) => storagesFor(`fresh-new:${name}`)
			});
			await store.settings.put({ key: MOVE_RECORD_KEY, value: { at: 'now' } });
			await store.close();
			const again = await moveBooks({
				orbitdb: booksOrbit,
				names: fresh,
				encryptionKey,
				formerWriter: person.did,
				openOptions
			});
			expect(again.records).toEqual({ invoices: 0, customers: 0, settings: 0 });
		} finally {
			await booksOrbit.stop();
		}
	});

	it('refuses to move without knowing who wrote the books', async () => {
		await expect(
			moveBooks({ orbitdb: { identity: { id: 'x' } }, names, encryptionKey, formerWriter: '' })
		).rejects.toThrow(/written by/);
	});
});
