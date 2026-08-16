/**
 * Wraps a `ScrapeProvider` with a sources-table dedup layer and a
 * `BlobStorage`-backed content cache.
 *
 * Lookup path (fast, no lock):
 *   sha256(canonicalUrl) → SELECT … WHERE url_hash = $1 AND last_fetched_at
 *   is fresh AND content_ref is a non-empty blob key → `BlobStorage.get(
 *   content_ref)` → decode markdown → return a `ScrapedPage` with `units = 0`
 *   (cache hit is free). A cache-read failure (unreadable or empty blob) is
 *   not fatal: it degrades to the miss path so the live page is re-fetched
 *   rather than denied to the model.
 *
 * Miss path (advisory-locked, stampede-safe):
 *   `pg_advisory_xact_lock(hashtext('scrape:<url_hash>'))` → re-check inside
 *   the lock (someone else may have filled the cache in the meantime) →
 *   `inner.scrape(input)` → put markdown bytes under
 *   `scrape/<content_hash>` in `BlobStorage` → `UPSERT sources` by `url_hash`
 *   → return the fresh `ScrapedPage` with the provider's real `units` count.
 *
 * TTL is per-domain (news = 24h, default = 7d). Canonicalization today is
 * minimal (trim trailing slash, lowercase host); a richer canonicalizer is a
 * future-when-it-matters change — the current form is enough to deduplicate
 * obvious repeats across a single research run.
 *
 * `research_run_sources` attribution is intentionally NOT handled here. It
 * lives at the tool-loop caller (`research-service.ts` phase 1) which knows
 * the `research_id` and can emit a `tool.cache_hit` SSE event. Keeping this
 * layer ignorant of the run context lets the same wrapper serve any caller.
 */

import { createHash } from 'node:crypto'

import { Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import {
	BlobStorage,
	type ScrapeInput,
	ScrapeProvider,
} from '../application/ports'
import { canonicalizeUrl } from '../application/source-key'
import { recordFetchedSource } from '../application/source-record'
import { ProviderError } from '../domain/errors'
import { ScrapedPage } from '../domain/types'
import { cacheBypassConfig } from './_config'

// The SQL client camelCases result keys (snake_case DB ↔ camelCase TS), so the
// `content_ref`/`content_hash` columns arrive as `contentRef`/`contentHash` —
// read them by those names, not the SQL spelling.
interface SourcesCacheHit {
	readonly id: string
	readonly url: string
	readonly contentRef: string | null
	readonly contentHash: string
}

const sha256Hex = (input: string): string =>
	createHash('sha256').update(input).digest('hex')

const extractDomain = (url: string): string => {
	try {
		return new URL(url).hostname.toLowerCase()
	} catch {
		return 'unknown'
	}
}

const NEWS_DOMAINS = new Set([
	'elpais.com',
	'lavanguardia.com',
	'ara.cat',
	'elpuntavui.cat',
	'vilaweb.cat',
	'elperiodico.com',
	'324.cat',
])

const CORPORATE_ROOT_TLDS = new Set(['about', 'company', 'corporate'])

export const scrapeCacheTtlHours = (domain: string, path: string): number => {
	if (NEWS_DOMAINS.has(domain)) return 24
	const firstSeg = path.split('/').filter(Boolean)[0] ?? ''
	if (CORPORATE_ROOT_TLDS.has(firstSeg)) return 24 * 30
	return 24 * 7
}

const blobKeyFor = (contentHash: string): string => `scrape/${contentHash}`

export const makeCachedScrape = () =>
	Layer.effect(
		ScrapeProvider,
		Effect.gen(function* () {
			const inner = yield* ScrapeProvider
			const sql = yield* SqlClient.SqlClient
			const blob = yield* BlobStorage
			// Read once, when the layer is built, so a pass cannot change its mind
			// halfway and read some pages off the record and fetch others afresh.
			const bypassCache = yield* cacheBypassConfig

			// Reads a cached row's stored markdown, or fails with a classified
			// `provider:'cache'` ProviderError when the row points at nothing
			// (empty content_ref) or the blob store can't return the bytes.
			// `blob.get` already surfaces its failure as such a ProviderError.
			const readFromBlob = (hit: SourcesCacheHit) =>
				Effect.gen(function* () {
					if (!hit.contentRef) {
						return yield* Effect.fail(
							new ProviderError({
								provider: 'cache',
								message: `sources row ${hit.id} has no content_ref`,
								recoverable: false,
							}),
						)
					}
					const bytes = yield* blob.get(hit.contentRef)
					return new TextDecoder().decode(bytes)
				})

			const scrape = (input: ScrapeInput) =>
				Effect.gen(function* () {
					const canonical = canonicalizeUrl(input.url)
					const urlHash = sha256Hex(canonical)
					const domain = extractDomain(canonical)
					const path = (() => {
						try {
							return new URL(canonical).pathname
						} catch {
							return '/'
						}
					})()
					const ttl = scrapeCacheTtlHours(domain, path)

					// Serve a cached row, or fall through to a fresh fetch. A warm row
					// whose blob is missing, unreadable, or empty must never fail the
					// scrape: denied the page, the model answers from training memory and
					// invents unsourced facts. So a cache-read failure degrades to None,
					// signalling the caller to re-fetch the live page instead.
					const readCached = (row: SourcesCacheHit) =>
						readFromBlob(row).pipe(
							Effect.map(markdown =>
								Option.some(
									new ScrapedPage({
										url: canonical,
										// The row stores the URL the page finally resolved to, so a
										// cached hit still knows a redirect destination (a rebrand).
										resolvedUrl: row.url,
										markdown,
										contentHash: row.contentHash,
										units: 0,
									}),
								),
							),
							Effect.catchTag('ProviderError', error =>
								Effect.logWarning('cache.read_failed').pipe(
									Effect.annotateLogs({
										event: 'cache.read_failed',
										port: 'scrape',
										cache_table: 'sources',
										key_hash: urlHash,
										message: error.message,
									}),
									Effect.as(Option.none<ScrapedPage>()),
								),
							),
						)

					// The stored page, if one was fetched recently enough to still stand
					// for the live one. Asked twice — once here and once holding the lock
					// — so a page fetched while this call queued is not fetched again.
					const findStoredPage = () =>
						bypassCache
							? Effect.succeed([])
							: sql<SourcesCacheHit>`
						SELECT id, url, content_ref, content_hash
						FROM sources
						WHERE url_hash = ${urlHash}
							AND last_fetched_at > now() - (${`${ttl} hours`})::interval
							AND content_ref IS NOT NULL
							AND content_ref <> ''
						LIMIT 1
					`

					const hits = yield* findStoredPage()
					const hit = hits[0]
					if (hit) {
						const cached = yield* readCached(hit)
						if (Option.isSome(cached)) {
							yield* Effect.logDebug('cache.hit').pipe(
								Effect.annotateLogs({
									event: 'cache.hit',
									port: 'scrape',
									cache_table: 'sources',
									key_hash: urlHash,
								}),
							)
							return cached.value
						}
					}

					return yield* Effect.gen(function* () {
						yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`scrape:${urlHash}`}))`

						const rehits = yield* findStoredPage()
						const rehit = rehits[0]
						if (rehit) {
							const cached = yield* readCached(rehit)
							if (Option.isSome(cached)) return cached.value
						}

						const page = yield* inner.scrape(input)
						const markdown = page.markdown ?? ''

						// Best-effort cache write: the page is already in hand, so a store
						// failure must not fail the scrape. On failure we record no
						// content_ref, so the next lookup re-fetches rather than pointing at
						// a blob that was never written.
						let storedRef: string | null = null
						if (markdown.length > 0) {
							const contentRef = blobKeyFor(page.contentHash)
							const wrote = yield* blob
								.put(
									contentRef,
									new TextEncoder().encode(markdown),
									'text/markdown',
								)
								.pipe(
									Effect.as(true),
									Effect.catchTag('ProviderError', error =>
										Effect.logWarning('cache.write_failed').pipe(
											Effect.annotateLogs({
												event: 'cache.write_failed',
												port: 'scrape',
												cache_table: 'sources',
												key_hash: urlHash,
												message: error.message,
											}),
											Effect.as(false),
										),
									),
								)
							if (wrote) storedRef = contentRef
						}

						yield* recordFetchedSource(sql, {
							requestedUrl: canonical,
							...(page.resolvedUrl !== undefined
								? { resolvedUrl: page.resolvedUrl }
								: {}),
							...(page.title !== undefined ? { title: page.title } : {}),
							...(page.language !== undefined
								? { language: page.language }
								: {}),
							contentHash: page.contentHash,
							contentRef: storedRef,
							provider: 'scrape',
						})

						return page
					}).pipe(sql.withTransaction)
				}).pipe(
					Effect.catchTag(
						'SqlError',
						(e): Effect.Effect<ScrapedPage, ProviderError> =>
							Effect.fail(
								new ProviderError({
									provider: 'cache',
									message: `sources query failed: ${e.message}`,
									recoverable: true,
								}),
							),
					),
				)

			return ScrapeProvider.of({ scrape })
		}),
	)
