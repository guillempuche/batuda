// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { createHash, randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, describe, expect, it } from 'vitest'

import {
	makeCachedSearch,
	type SearchInput,
	SearchProvider,
	SearchResult,
	SearchResultItem,
} from '@batuda/research'

import { PgLive } from '../db/client.js'

// A search records the pages it found so a run can point at the evidence behind
// its answers. These tests drive that against real Postgres with a fake vendor,
// and pin the two rules that keep the record honest: a page a search named is
// written down even when the answer came out of `search_cache`, and a search
// never restates when a page was last read — only a real read may do that,
// because the scrape cache and the retention sweep both trust that date.

// A unique host per test keeps each test's `sources` row isolated by url_hash.
const freshHost = () => `search-record-${randomUUID()}.example`

// canonicalizeUrl() runs a bare-host URL through `new URL().toString()`, which
// keeps the trailing slash — so this matches the hash the cache computes.
const hashOf = (url: string): string =>
	createHash('sha256').update(new URL(url).toString()).digest('hex')

// The `search_cache` row a query's answer lands on: the same fields
// computeSearchCacheKey() joins — provider, query, then the four filters these
// tests leave unset.
const cacheKeyFor = (query: string): string =>
	createHash('sha256')
		.update(['search', query, '', '', '', ''].join('|'))
		.digest('hex')

const seededHashes: string[] = []
const seededKeys: string[] = []

const runSql = <A>(
	body: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown>,
): Promise<A> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* body(sql)
		}).pipe(Effect.provide(PgLive), Effect.orDie) as Effect.Effect<
			A,
			never,
			never
		>,
	)

/** Seed a page already on file as fully read, with its text stored. */
const seedFetchedSource = (url: string, urlHash: string): Promise<unknown> =>
	runSql(
		sql => sql`
			INSERT INTO sources (
				id, kind, provider, url, url_hash, domain,
				content_hash, content_ref, first_fetched_at, last_fetched_at
			) VALUES (
				${randomUUID()}, 'web', 'it-stub', ${url}, ${urlHash}, 'it.example',
				'page-hash', 'scrape/page-hash',
				now() - interval '3 days', now() - interval '3 days'
			)
		`,
	)

// The SQL client camelCases every column it hands back, raw templates included,
// so a snake_case field name here would silently read as undefined.
interface SourceRow {
	readonly contentHash: string
	readonly contentRef: string | null
	readonly lastFetchedAt: Date
}

const readSource = (urlHash: string): Promise<SourceRow | undefined> =>
	runSql(sql =>
		sql<SourceRow>`
			SELECT content_hash, content_ref, last_fetched_at
			FROM sources WHERE url_hash = ${urlHash} LIMIT 1
		`.pipe(Effect.map(rows => rows[0])),
	)

/** Drive one search through the cached wrapper with a counting fake vendor. */
const runSearch = (opts: {
	input: SearchInput
	items: ReadonlyArray<{ url: string; title: string; content?: string }>
	calls: { count: number }
}): Promise<SearchResult> => {
	const cached = makeCachedSearch().pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(SearchProvider)(
					SearchProvider.of({
						search: () =>
							Effect.sync(() => {
								opts.calls.count += 1
								return new SearchResult({
									items: opts.items.map(
										i =>
											new SearchResultItem({
												url: i.url,
												title: i.title,
												snippet: i.content ?? '',
												...(i.content !== undefined
													? { content: i.content }
													: {}),
											}),
									),
									units: 2,
								})
							}),
					}),
				),
				PgLive,
			),
		),
	)
	return Effect.runPromise(
		Effect.gen(function* () {
			const svc = yield* SearchProvider
			return yield* svc.search(opts.input)
		}).pipe(Effect.provide(cached), Effect.orDie),
	)
}

afterAll(async () => {
	await runSql(sql =>
		Effect.gen(function* () {
			for (const urlHash of seededHashes) {
				yield* sql`DELETE FROM sources WHERE url_hash = ${urlHash}`
			}
			for (const keyHash of seededKeys) {
				yield* sql`DELETE FROM search_cache WHERE key_hash = ${keyHash}`
			}
		}),
	)
})

describe('search cache — a search records the pages it found', () => {
	describe('when the same search is answered from the cache', () => {
		it('should still write down the pages it named', async () => {
			// GIVEN a search whose results carry real page text
			const host = freshHost()
			const url = `https://${host}/`
			const urlHash = hashOf(url)
			seededHashes.push(urlHash)
			const query = `record-on-hit-${randomUUID()}`
			seededKeys.push(cacheKeyFor(query))

			const calls = { count: 0 }
			const items = [{ url, title: 'Acme', content: 'Acme is a freight firm.' }]

			// WHEN it runs once to fill the cache, the row is removed, and it runs
			// again — the second answer comes from the cache without reaching the
			// vendor
			await runSearch({ input: { query }, items, calls })
			await runSql(sql => sql`DELETE FROM sources WHERE url_hash = ${urlHash}`)
			await runSearch({ input: { query }, items, calls })

			// THEN the vendor was asked only once, and the page is on record anyway,
			// pointing at no stored text since a search never reads the page itself
			expect(calls.count).toBe(1)
			const row = await readSource(urlHash)
			expect(row).toBeDefined()
			expect(row?.contentRef).toBeNull()
		})
	})

	describe('when a search names a page whose text is already on file', () => {
		it('should leave the stored record untouched', async () => {
			// GIVEN a page already read and stored three days ago
			const host = freshHost()
			const url = `https://${host}/`
			const urlHash = hashOf(url)
			seededHashes.push(urlHash)
			await seedFetchedSource(url, urlHash)
			const before = await readSource(urlHash)

			const query = `no-refresh-${randomUUID()}`
			seededKeys.push(cacheKeyFor(query))

			// WHEN a search turns up that same page, carrying only a short passage
			await runSearch({
				input: { query },
				items: [{ url, title: 'Acme', content: 'A short passage.' }],
				calls: { count: 0 },
			})

			// THEN the stored text and the date it was read are untouched: a passing
			// mention is not a fresh read, and letting it act like one would keep a
			// stale copy alive and hide it from the retention sweep
			const after = await readSource(urlHash)
			expect(after?.lastFetchedAt.getTime()).toBe(
				before?.lastFetchedAt.getTime(),
			)
			expect(after?.contentHash).toBe('page-hash')
			expect(after?.contentRef).toBe('scrape/page-hash')
		})
	})
})
