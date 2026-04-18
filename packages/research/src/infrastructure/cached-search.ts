/**
 * Wraps a `SearchProvider` with a DB-backed TTL cache (`search_cache`).
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

import { Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { type SearchInput, SearchProvider } from '../application/ports'
import { ProviderError } from '../domain/errors'
import { SearchResult } from '../domain/types'

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

			const lookup = (keyHash: string) =>
				sql<{ items: unknown; units_cost: number }>`
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

					const hits = yield* lookup(keyHash)
					if (hits[0]) {
						yield* sql`
							UPDATE search_cache
							SET hit_count = hit_count + 1
							WHERE key_hash = ${keyHash}
						`
						const decoded = yield* decodeSearchResult(hits[0].items).pipe(
							Effect.mapError(
								e =>
									new ProviderError({
										provider: 'cache',
										message: `search_cache decode failed: ${String(e)}`,
										recoverable: false,
									}),
							),
						)
						yield* Effect.logDebug('cache.hit').pipe(
							Effect.annotateLogs({
								event: 'cache.hit',
								port: 'search',
								cache_table: 'search_cache',
								key_hash: keyHash,
							}),
						)
						return new SearchResult({ items: decoded.items, units: 0 })
					}

					return yield* Effect.gen(function* () {
						yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`search:${keyHash}`}))`
						const rehits = yield* lookup(keyHash)
						if (rehits[0]) {
							const decoded = yield* decodeSearchResult(rehits[0].items).pipe(
								Effect.mapError(
									e =>
										new ProviderError({
											provider: 'cache',
											message: `search_cache decode failed: ${String(e)}`,
											recoverable: false,
										}),
								),
							)
							return new SearchResult({ items: decoded.items, units: 0 })
						}

						const result = yield* inner.search(input)
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
