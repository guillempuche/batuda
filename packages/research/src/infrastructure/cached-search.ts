/**
 * Wraps a SearchProvider with a shared in-memory TTL cache.
 *
 * Key = stable hash of (query + limit + recency + location + languages).
 * TTL = 5 minutes (covers the lifetime of a typical fan-out group).
 * Cache is per-server-instance (not cross-node), which is fine for v1.
 *
 * Usage in providers-live.ts:
 *   const cachedSearch = makeCachedSearch().pipe(Layer.provide(innerSearchLayer))
 */

import { Effect, HashMap, Layer, Option, Ref } from 'effect'

import { type SearchInput, SearchProvider } from '../application/ports'
import type { SearchResult } from '../domain/types'

interface CacheEntry {
	readonly result: SearchResult
	readonly expiresAt: number
}

/** Deterministic hash of a SearchInput for cache keying. */
const stableHash = (input: SearchInput): string => {
	const parts = [
		input.query,
		String(input.limit ?? ''),
		String(input.recency?.days ?? ''),
		input.location ?? '',
		(input.languages ?? []).sort().join(','),
	]
	// Simple string hash — collisions are harmless (just a cache miss)
	let h = 0
	const s = parts.join('|')
	for (let i = 0; i < s.length; i++) {
		h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
	}
	return String(h)
}

export const makeCachedSearch = (ttlMs = 5 * 60_000) =>
	Layer.effect(
		SearchProvider,
		Effect.gen(function* () {
			const inner = yield* SearchProvider
			const cache = yield* Ref.make(HashMap.empty<string, CacheEntry>())

			return SearchProvider.of({
				search: input =>
					Effect.gen(function* () {
						const key = stableHash(input)
						const now = Date.now()
						const map = yield* Ref.get(cache)
						const hit = HashMap.get(map, key)

						if (Option.isSome(hit) && hit.value.expiresAt > now) {
							return hit.value.result
						}

						const result = yield* inner.search(input)
						yield* Ref.update(cache, m =>
							HashMap.set(m, key, {
								result,
								expiresAt: now + ttlMs,
							}),
						)
						return result
					}),
			})
		}),
	)
