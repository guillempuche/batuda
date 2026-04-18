/**
 * Wraps a `ScrapeProvider` with a sources-table dedup layer and a
 * `BlobStorage`-backed content cache.
 *
 * Lookup path (fast, no lock):
 *   sha256(canonicalUrl) → SELECT … WHERE url_hash = $1 AND last_fetched_at
 *   is fresh → `BlobStorage.get(content_ref)` → decode markdown → return
 *   a `ScrapedPage` with `units = 0` (cache hit is free).
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

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import {
	BlobStorage,
	type ScrapeInput,
	ScrapeProvider,
} from '../application/ports'
import { ProviderError } from '../domain/errors'
import { ScrapedPage } from '../domain/types'

interface SourcesCacheHit {
	readonly id: string
	readonly content_ref: string | null
	readonly content_hash: string
}

const sha256Hex = (input: string): string =>
	createHash('sha256').update(input).digest('hex')

export const canonicalizeUrl = (url: string): string => {
	try {
		const u = new URL(url)
		u.hostname = u.hostname.toLowerCase()
		u.hash = ''
		if (u.pathname.endsWith('/') && u.pathname !== '/') {
			u.pathname = u.pathname.slice(0, -1)
		}
		return u.toString()
	} catch {
		return url
	}
}

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

const sourceIdFor = (urlHash: string): string => `src_${urlHash.slice(0, 16)}`

export const makeCachedScrape = () =>
	Layer.effect(
		ScrapeProvider,
		Effect.gen(function* () {
			const inner = yield* ScrapeProvider
			const sql = yield* SqlClient.SqlClient
			const blob = yield* BlobStorage

			const readFromBlob = (hit: SourcesCacheHit) =>
				Effect.gen(function* () {
					if (!hit.content_ref) {
						return yield* Effect.fail(
							new ProviderError({
								provider: 'cache',
								message: `sources row ${hit.id} has no content_ref`,
								recoverable: false,
							}),
						)
					}
					const bytes = yield* blob.get(hit.content_ref).pipe(
						Effect.mapError(
							(e: unknown) =>
								new ProviderError({
									provider: 'cache',
									message: `blob get failed: ${
										e instanceof Error ? e.message : String(e)
									}`,
									recoverable: false,
								}),
						),
					)
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

					const hits = yield* sql<SourcesCacheHit>`
						SELECT id, content_ref, content_hash
						FROM sources
						WHERE url_hash = ${urlHash}
							AND last_fetched_at > now() - (${`${ttl} hours`})::interval
							AND content_ref IS NOT NULL
						LIMIT 1
					`
					const hit = hits[0]
					if (hit) {
						const markdown = yield* readFromBlob(hit)
						yield* Effect.logDebug('cache.hit').pipe(
							Effect.annotateLogs({
								event: 'cache.hit',
								port: 'scrape',
								cache_table: 'sources',
								key_hash: urlHash,
							}),
						)
						return new ScrapedPage({
							url: canonical,
							markdown,
							contentHash: hit.content_hash,
							units: 0,
						})
					}

					return yield* Effect.gen(function* () {
						yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`scrape:${urlHash}`}))`

						const rehits = yield* sql<SourcesCacheHit>`
							SELECT id, content_ref, content_hash
							FROM sources
							WHERE url_hash = ${urlHash}
								AND last_fetched_at > now() - (${`${ttl} hours`})::interval
								AND content_ref IS NOT NULL
							LIMIT 1
						`
						const rehit = rehits[0]
						if (rehit) {
							const markdown = yield* readFromBlob(rehit)
							return new ScrapedPage({
								url: canonical,
								markdown,
								contentHash: rehit.content_hash,
								units: 0,
							})
						}

						const page = yield* inner.scrape(input)
						const markdown = page.markdown ?? ''
						const contentRef = blobKeyFor(page.contentHash)

						if (markdown.length > 0) {
							yield* blob
								.put(
									contentRef,
									new TextEncoder().encode(markdown),
									'text/markdown',
								)
								.pipe(
									Effect.mapError(
										(e: unknown) =>
											new ProviderError({
												provider: 'cache',
												message: `blob put failed: ${
													e instanceof Error ? e.message : String(e)
												}`,
												recoverable: false,
											}),
									),
								)
						}

						yield* sql`
							INSERT INTO sources (
								id, kind, provider, url, url_hash, domain,
								title, language, content_hash, content_ref,
								first_fetched_at, last_fetched_at
							) VALUES (
								${sourceIdFor(urlHash)}, 'web', 'scrape', ${canonical}, ${urlHash}, ${domain},
								${page.title ?? null}, ${page.language ?? null},
								${page.contentHash}, ${markdown.length > 0 ? contentRef : null},
								now(), now()
							)
							ON CONFLICT (url_hash) DO UPDATE SET
								last_fetched_at = now(),
								content_hash    = EXCLUDED.content_hash,
								content_ref     = EXCLUDED.content_ref,
								title           = COALESCE(EXCLUDED.title, sources.title),
								language        = COALESCE(EXCLUDED.language, sources.language)
						`

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
