import { describe, expect, it } from 'vitest'

import { computeSearchCacheKey, searchCacheTtlHours } from './cached-search'

describe('search cache key computation', () => {
	it('should key by every caller-facing filter so different filters miss', () => {
		// GIVEN four searches that differ in exactly one filter
		const base = computeSearchCacheKey('search', { query: 'q' })
		const byLimit = computeSearchCacheKey('search', { query: 'q', limit: 10 })
		const byRecency = computeSearchCacheKey('search', {
			query: 'q',
			recency: { days: 7 },
		})
		const byLocation = computeSearchCacheKey('search', {
			query: 'q',
			location: 'es',
		})
		const byLanguage = computeSearchCacheKey('search', {
			query: 'q',
			languages: ['ca'],
		})

		// THEN each distinct filter produces a distinct cache key
		const keys = new Set([base, byLimit, byRecency, byLocation, byLanguage])
		expect(keys.size).toBe(5)
	})

	it('should treat language order as insignificant', () => {
		// GIVEN two searches that list the same languages in different orders
		const a = computeSearchCacheKey('search', {
			query: 'q',
			languages: ['ca', 'es'],
		})
		const b = computeSearchCacheKey('search', {
			query: 'q',
			languages: ['es', 'ca'],
		})

		// THEN the keys collide — the helper sorts languages before hashing
		expect(a).toBe(b)
	})
})

describe('searchCacheTtlHours', () => {
	it('should default to 24h when no recency filter is set', () => {
		// GIVEN an open-ended query
		// THEN the TTL is 24 hours
		expect(searchCacheTtlHours({ query: 'q' })).toBe(24)
	})

	it('should shrink the TTL proportional to the recency window', () => {
		// GIVEN a recency-filtered query for the last 7 days
		// THEN the TTL is 7/4 = 1.75h — fresh-news windows expire faster than their window
		expect(searchCacheTtlHours({ query: 'q', recency: { days: 7 } })).toBe(
			7 / 4,
		)
	})

	it('should floor the TTL at 15 minutes for very short recency windows', () => {
		// GIVEN a recency of 0 days (today-only)
		// THEN the TTL never drops below 0.25h (15 minutes)
		expect(searchCacheTtlHours({ query: 'q', recency: { days: 0 } })).toBe(0.25)
	})
})

// ── DB-backed behaviors ──
// Real Postgres for `search_cache` row lifecycle (expires_at, hit_count).
// Require `pnpm cli services up` and the 0001 migration applied.
describe('search cache layer (integration)', () => {
	it.todo(
		'should return cached search results on the second identical query within TTL',
	)
	it.todo('should refuse to serve rows where expires_at is in the past')
})
