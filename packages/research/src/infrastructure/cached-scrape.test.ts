import { describe, expect, it } from 'vitest'

import { scrapeCacheTtlHours } from './cached-scrape'

describe('scrapeCacheTtlHours', () => {
	it('should pin news domains to a 24h TTL', () => {
		// GIVEN one of the known news domains
		// THEN the scrape TTL is 24h — news ages fast
		expect(scrapeCacheTtlHours('elpais.com', '/any/path')).toBe(24)
		expect(scrapeCacheTtlHours('ara.cat', '/article/x')).toBe(24)
	})

	it('should extend corporate-root paths to a 30-day TTL', () => {
		// GIVEN a /about or /company path on any domain
		// THEN the TTL jumps to 30 days — corporate descriptors rarely change
		expect(scrapeCacheTtlHours('example.com', '/about/us')).toBe(24 * 30)
		expect(scrapeCacheTtlHours('example.com', '/company')).toBe(24 * 30)
	})

	it('should fall back to 7 days for everything else', () => {
		// GIVEN an unclassified domain and path
		// THEN the default 7-day window applies
		expect(scrapeCacheTtlHours('example.com', '/products/x')).toBe(24 * 7)
	})
})

// ── DB-backed behaviors ──
// Real Postgres `sources` + `BlobStorage` round-trip (advisory-lock stampede,
// TTL-window resolution, content_ref/blob payload). Require
// `pnpm cli services up` and the 0001 migration applied.
describe('scrape cache layer (integration)', () => {
	it.todo(
		'should key extraction cache by (content_hash, schema_name, schema_version)',
	)
	it.todo(
		'should collapse concurrent scrape misses to a single inner call via pg_advisory_xact_lock',
	)
})
