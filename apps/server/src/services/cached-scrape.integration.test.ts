// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { createHash, randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, describe, expect, it } from 'vitest'

import {
	BlobStorage,
	makeCachedScrape,
	ProviderError,
	type ScrapedPage,
	type ScrapeInput,
	ScrapeProvider,
} from '@batuda/research'

import { PgLive } from '../db/client.js'

// The scrape cache wraps the real ScrapeProvider with a `sources`-table lookup
// and a BlobStorage-backed content cache. These tests drive that wrapper against
// real Postgres with fakes for the inner provider and the blob store, so a
// broken cache (unreadable blob, empty content_ref, failing write) can be
// reproduced deterministically. The core guarantee: a warm-but-broken cache
// never fails a scrape — it degrades to a fresh fetch — so the model is never
// denied the page and pushed into inventing facts.

// A unique host per test keeps each run's `sources` row isolated by url_hash.
const freshHost = () => `cache-fallthrough-${randomUUID()}.example`
// canonicalizeUrl() runs a bare-host URL through `new URL().toString()`, which
// keeps the trailing slash — so this matches the hash the cache computes.
const hashOf = (url: string): string =>
	createHash('sha256').update(new URL(url).toString()).digest('hex')

type BlobGet = (key: string) => Effect.Effect<Uint8Array, ProviderError>
type BlobPut = (
	key: string,
	bytes: Uint8Array,
	contentType: string,
) => Effect.Effect<void, ProviderError>

const okBlobPut: BlobPut = () => Effect.void
const failingBlobGet: BlobGet = key =>
	Effect.fail(
		new ProviderError({
			provider: 'cache',
			message: `blob get failed for ${key}: simulated R2 read error`,
			recoverable: false,
		}),
	)

// Seed a warm sources row so a lookup finds a hit (or, with an empty
// content_ref, deliberately does not).
const seedWarmSource = (opts: {
	url: string
	urlHash: string
	contentRef: string | null
	contentHash: string
}): Promise<void> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`
				INSERT INTO sources (
					id, kind, provider, url, url_hash, domain,
					content_hash, content_ref, first_fetched_at, last_fetched_at
				) VALUES (
					${randomUUID()}, 'web', 'it-stub', ${opts.url}, ${opts.urlHash}, 'it.example',
					${opts.contentHash}, ${opts.contentRef}, now(), now()
				)
				ON CONFLICT (url_hash) DO UPDATE SET
					content_ref  = EXCLUDED.content_ref,
					content_hash = EXCLUDED.content_hash,
					last_fetched_at = now()
			`
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
	)

const readContentRef = (urlHash: string): Promise<string | null> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<{ content_ref: string | null }>`
				SELECT content_ref FROM sources WHERE url_hash = ${urlHash} LIMIT 1
			`
			return rows[0]?.content_ref ?? null
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<
			string | null,
			never,
			never
		>,
	)

const readUrlAndDomain = (
	urlHash: string,
): Promise<{ url: string; domain: string } | null> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<{ url: string; domain: string }>`
				SELECT url, domain FROM sources WHERE url_hash = ${urlHash} LIMIT 1
			`
			return rows[0] ?? null
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<
			{ url: string; domain: string } | null,
			never,
			never
		>,
	)

// Drive one scrape through the cached wrapper with the given fakes wired in.
const runScrape = (opts: {
	url: string
	inner: (input: ScrapeInput) => Effect.Effect<ScrapedPage, ProviderError>
	blobGet: BlobGet
	blobPut: BlobPut
}): Promise<ScrapedPage> => {
	const cached = makeCachedScrape().pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(ScrapeProvider)(
					ScrapeProvider.of({ scrape: opts.inner }),
				),
				Layer.succeed(BlobStorage)(
					BlobStorage.of({ get: opts.blobGet, put: opts.blobPut }),
				),
				PgLive,
			),
		),
	)
	return Effect.runPromise(
		Effect.gen(function* () {
			const svc = yield* ScrapeProvider
			return yield* svc.scrape({ url: opts.url, formats: ['markdown'] })
		}).pipe(Effect.provide(cached)),
	)
}

const seededHashes: string[] = []
const track = (urlHash: string): string => {
	seededHashes.push(urlHash)
	return urlHash
}

afterAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			for (const urlHash of seededHashes) {
				yield* sql`DELETE FROM sources WHERE url_hash = ${urlHash}`
			}
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
	)
})

describe('scrape cache — a broken cache degrades to a fresh fetch', () => {
	describe('when a warm row is present but its blob is unreadable', () => {
		it('should fall through to inner.scrape rather than fail the scrape', async () => {
			// GIVEN a warm sources row whose content_ref points at a blob the store
			//   can no longer return
			const url = `https://${freshHost()}/`
			const urlHash = track(hashOf(url))
			await seedWarmSource({
				url,
				urlHash,
				contentRef: 'scrape/warm-but-unreadable',
				contentHash: 'warm-but-unreadable',
			})
			let innerCalls = 0

			// WHEN the wrapper serves that URL and the blob read fails
			const page = await runScrape({
				url,
				inner: () => {
					innerCalls += 1
					return Effect.succeed({
						url,
						markdown: 'FRESH FROM PROVIDER',
						contentHash: 'fresh-1',
						units: 1,
					} as ScrapedPage)
				},
				blobGet: failingBlobGet,
				blobPut: okBlobPut,
			})

			// THEN the live page is fetched instead — the model gets real content,
			//   not a cache error that would starve it into inventing facts
			expect(page.markdown).toBe('FRESH FROM PROVIDER')
			expect(innerCalls).toBe(1)
		})
	})

	describe('when a warm row has an empty-string content_ref', () => {
		it('should treat it as a miss and never touch the blob store', async () => {
			// GIVEN a warm sources row whose content_ref is '' (points at nothing)
			const url = `https://${freshHost()}/`
			const urlHash = track(hashOf(url))
			await seedWarmSource({
				url,
				urlHash,
				contentRef: '',
				contentHash: 'empty-ref',
			})
			let innerCalls = 0
			let blobGetCalls = 0

			// WHEN the wrapper serves that URL
			const page = await runScrape({
				url,
				inner: () => {
					innerCalls += 1
					return Effect.succeed({
						url,
						markdown: 'FRESH AFTER EMPTY REF',
						contentHash: 'fresh-2',
						units: 1,
					} as ScrapedPage)
				},
				blobGet: key => {
					blobGetCalls += 1
					return failingBlobGet(key)
				},
				blobPut: okBlobPut,
			})

			// THEN the tightened lookup excludes the empty row, so no blob read is
			//   attempted and the page is fetched fresh
			expect(page.markdown).toBe('FRESH AFTER EMPTY REF')
			expect(innerCalls).toBe(1)
			expect(blobGetCalls).toBe(0)
		})
	})

	describe('when a warm row has a readable blob', () => {
		it('should serve the cached markdown without calling inner.scrape', async () => {
			// GIVEN a warm sources row whose content_ref points at a readable blob
			const url = `https://${freshHost()}/`
			const urlHash = track(hashOf(url))
			await seedWarmSource({
				url,
				urlHash,
				contentRef: 'scrape/readable-hit',
				contentHash: 'readable-hit',
			})

			// WHEN the wrapper serves that URL and the blob read succeeds
			const page = await runScrape({
				url,
				// A cache hit must never reach the provider — dying here proves it.
				inner: () =>
					Effect.die('inner.scrape must not be called on a cache hit'),
				blobGet: () =>
					Effect.succeed(new TextEncoder().encode('CACHED MARKDOWN')),
				blobPut: okBlobPut,
			})

			// THEN the cached content is returned, free (units = 0)
			expect(page.markdown).toBe('CACHED MARKDOWN')
			expect(page.units).toBe(0)
		})
	})

	describe('when the freshly-scraped page cannot be written to the blob store', () => {
		it('should still return the page and record no content_ref', async () => {
			// GIVEN no warm row (a cache miss) and a blob store that rejects writes
			const url = `https://${freshHost()}/`
			const urlHash = track(hashOf(url))

			// WHEN the wrapper fetches the page fresh and the cache write fails
			const page = await runScrape({
				url,
				inner: () =>
					Effect.succeed({
						url,
						markdown: 'FRESH DESPITE WRITE FAILURE',
						contentHash: 'fresh-4',
						units: 1,
					} as ScrapedPage),
				blobGet: failingBlobGet,
				blobPut: key =>
					Effect.fail(
						new ProviderError({
							provider: 'cache',
							message: `blob put failed for ${key}: simulated R2 write error`,
							recoverable: false,
						}),
					),
			})

			// THEN the scrape succeeds with the fetched page (the write failure is
			//   best-effort), and the row records no content_ref so the next lookup
			//   re-fetches rather than pointing at a blob that was never written
			expect(page.markdown).toBe('FRESH DESPITE WRITE FAILURE')
			expect(await readContentRef(urlHash)).toBeNull()
		})
	})
})

describe('scrape cache — a redirect destination survives the cache', () => {
	describe('when a freshly-fetched page resolved to a different host', () => {
		it('should store the resolved url + domain, keyed by the requested url_hash', async () => {
			// GIVEN a cache miss on a domain that 301s elsewhere (a rebrand), so the
			//   inner provider reports the destination in resolvedUrl
			const requested = `https://${freshHost()}/`
			const destination = `https://dest-${randomUUID()}.example/`
			const urlHash = track(hashOf(requested))

			// WHEN the wrapper fetches it fresh
			const page = await runScrape({
				url: requested,
				inner: () =>
					Effect.succeed({
						url: requested,
						resolvedUrl: destination,
						markdown: 'REBRANDED SITE',
						contentHash: 'redirect-1',
						units: 1,
					} as ScrapedPage),
				blobGet: failingBlobGet,
				blobPut: okBlobPut,
			})

			// THEN the returned page keeps the requested url but carries the
			//   destination, and the persisted row records the destination the page
			//   really resolved to (still keyed by the requested url_hash so the
			//   lookup hits)
			expect(page.resolvedUrl).toBe(destination)
			const stored = await readUrlAndDomain(urlHash)
			expect(stored?.url).toBe(destination)
			expect(stored?.domain).toBe(new URL(destination).hostname)
		})
	})

	describe('when a warm row was stored under a redirect destination', () => {
		it('should return the destination as resolvedUrl on a cache hit', async () => {
			// GIVEN a warm sources row whose stored url is the redirect destination,
			//   keyed by the requested host's url_hash, with a readable blob
			const requested = `https://${freshHost()}/`
			const destination = `https://dest-${randomUUID()}.example/`
			const urlHash = track(hashOf(requested))
			await seedWarmSource({
				url: destination,
				urlHash,
				contentRef: 'scrape/redirect-hit',
				contentHash: 'redirect-hit',
			})

			// WHEN the wrapper serves the requested URL from cache
			const page = await runScrape({
				url: requested,
				inner: () =>
					Effect.die('inner.scrape must not be called on a cache hit'),
				blobGet: () =>
					Effect.succeed(new TextEncoder().encode('CACHED REBRAND')),
				blobPut: okBlobPut,
			})

			// THEN the hit exposes the destination via resolvedUrl (so grounding can
			//   still follow the rebrand) while url stays the requested address
			expect(page.markdown).toBe('CACHED REBRAND')
			expect(page.resolvedUrl).toBe(destination)
			expect(page.url).toBe(new URL(requested).toString())
		})
	})
})
