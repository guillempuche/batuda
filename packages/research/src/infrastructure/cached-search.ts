/**
 * Wraps a `SearchProvider` with a DB-backed TTL cache (`search_cache`), and
 * writes every result carrying page text into `sources` so a run can point at
 * what it read.
 *
 * Key = sha256(provider + query + limit + recency + location + sorted
 * languages). TTL is 24h for open-ended queries, `max(recency_days/4 h,
 * 15min)` when the caller passes a `recency` filter — fresh-news windows
 * expire faster so stale results don't dominate.
 *
 * Miss path is advisory-locked: concurrent identical queries from parallel
 * research fibers collapse to a single provider call. Lock is keyed by the
 * computed `key_hash` so different queries don't contend.
 *
 * The `items` JSON round-trips through `Schema.decodeUnknown(SearchResult)`
 * so the decoded value carries the same `SearchResult` class identity the
 * providers produce — callers that `.pipe(Schema.decode(…))` downstream stay
 * unchanged.
 */

import { createHash } from 'node:crypto'

import { Cause, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { type SearchInput, SearchProvider } from '../application/ports'
import { recordSeenSources } from '../application/source-record'
import { ProviderError } from '../domain/errors'
import { SearchResult } from '../domain/types'
import { cacheBypassConfig } from './_config'

const sha256Hex = (input: string): string =>
	createHash('sha256').update(input).digest('hex')

export const computeSearchCacheKey = (
	provider: string,
	input: SearchInput,
): string => {
	const parts = [
		provider,
		input.query,
		String(input.limit ?? ''),
		String(input.recency?.days ?? ''),
		input.location ?? '',
		(input.languages ?? []).slice().sort().join(','),
	]
	return sha256Hex(parts.join('|'))
}

export const searchCacheTtlHours = (input: SearchInput): number => {
	if (input.recency?.days != null) {
		return Math.max(input.recency.days / 4, 0.25)
	}
	return 24
}

const decodeSearchResult = Schema.decodeUnknownEffect(SearchResult)

export const makeCachedSearch = () =>
	Layer.effect(
		SearchProvider,
		Effect.gen(function* () {
			const inner = yield* SearchProvider
			const sql = yield* SqlClient.SqlClient
			// Read once, when the layer is built, so a pass cannot change its mind
			// halfway and answer some searches from a cache and some from the vendor.
			const bypassCache = yield* cacheBypassConfig

			const lookup = (keyHash: string) =>
				bypassCache
					? Effect.succeed([])
					: sql<{ items: unknown; units_cost: number }>`
					SELECT items, units_cost
					FROM search_cache
					WHERE key_hash = ${keyHash}
						AND expires_at > now()
					LIMIT 1
				`

			const search = (input: SearchInput) =>
				Effect.gen(function* () {
					const providerLabel = 'search'
					const keyHash = computeSearchCacheKey(providerLabel, input)
					const ttlHours = searchCacheTtlHours(input)

					// A result carrying real page text is something the run can quote, so
					// the page goes on the record. This holds for an answer served out of
					// `search_cache` too: what a run has to show for its findings should
					// not depend on whether someone ran the same search earlier.
					const recordResultSources = (result: SearchResult) =>
						recordSeenSources(
							sql,
							result.items.flatMap(item => {
								const text = item.content?.trim() ?? ''
								return text.length === 0
									? []
									: [
											{
												url: item.url,
												...(item.title ? { title: item.title } : {}),
												contentHash: sha256Hex(text),
												provider: providerLabel,
											},
										]
							}),
						)

					// The vendor fallback sits inside this wrapper, so a stored row we
					// can no longer read would sink the whole run without a single
					// vendor being asked. Both reads below go through here.
					const readCachedRow = (items: unknown) =>
						decodeSearchResult(items).pipe(
							Effect.mapError(
								e =>
									new ProviderError({
										provider: 'cache',
										message: `search_cache decode failed: ${String(e)}`,
										recoverable: false,
									}),
							),
							Effect.map(Option.some),
							Effect.catchCause(cause =>
								// A cancelled run stays cancelled — only a row we cannot read
								// falls through to a live search.
								Cause.hasInterruptsOnly(cause)
									? Effect.failCause(cause)
									: Effect.logWarning('cache.read_failed').pipe(
											Effect.annotateLogs({
												event: 'cache.read_failed',
												port: 'search',
												cache_table: 'search_cache',
												key_hash: keyHash,
												cause: Cause.pretty(cause),
											}),
											Effect.as(Option.none<SearchResult>()),
										),
							),
						)

					const hits = yield* lookup(keyHash)
					const cachedRow = hits[0]
					if (cachedRow) {
						const cached = yield* readCachedRow(cachedRow.items)
						if (Option.isSome(cached)) {
							yield* sql`
								UPDATE search_cache
								SET hit_count = hit_count + 1
								WHERE key_hash = ${keyHash}
							`
							yield* Effect.logDebug('cache.hit').pipe(
								Effect.annotateLogs({
									event: 'cache.hit',
									port: 'search',
									cache_table: 'search_cache',
									key_hash: keyHash,
								}),
							)
							yield* recordResultSources(cached.value)
							return new SearchResult({ items: cached.value.items, units: 0 })
						}
					}

					return yield* Effect.gen(function* () {
						yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`search:${keyHash}`}))`
						const rehits = yield* lookup(keyHash)
						const rehitRow = rehits[0]
						if (rehitRow) {
							const decoded = yield* readCachedRow(rehitRow.items)
							if (Option.isSome(decoded)) {
								yield* recordResultSources(decoded.value)
								return new SearchResult({
									items: decoded.value.items,
									units: 0,
								})
							}
						}

						const result = yield* inner.search(input)
						// Don't cache an empty result: a transient zero-hit response
						// (a Brave blip, an over-tight recency window) would otherwise
						// pin every identical query to "no results" for the whole TTL
						// instead of trying again next time.
						if (result.items.length > 0) {
							yield* sql`
								INSERT INTO search_cache (
									key_hash, provider, query, items,
									units_cost, cached_at, expires_at
								) VALUES (
									${keyHash}, ${providerLabel}, ${input.query},
									${JSON.stringify(result)}::jsonb,
									${result.units},
									now(), now() + (${`${ttlHours} hours`})::interval
								)
								ON CONFLICT (key_hash) DO UPDATE SET
									items       = EXCLUDED.items,
									units_cost  = EXCLUDED.units_cost,
									cached_at   = EXCLUDED.cached_at,
									expires_at  = EXCLUDED.expires_at
							`
						}

						yield* recordResultSources(result)
						return result
					}).pipe(sql.withTransaction)
				}).pipe(
					Effect.catchTag(
						'SqlError',
						(e): Effect.Effect<SearchResult, ProviderError> =>
							Effect.fail(
								new ProviderError({
									provider: 'cache',
									message: `search_cache query failed: ${e.message}`,
									recoverable: true,
								}),
							),
					),
				)

			return SearchProvider.of({ search })
		}),
	)
