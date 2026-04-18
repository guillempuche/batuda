import { describe, expect, it } from 'vitest'

import { canonicalizeUrl, scrapeCacheTtlHours } from './cached-scrape'

describe('canonicalizeUrl', () => {
	it('should lowercase the hostname', () => {
		// GIVEN a URL with mixed-case host
		// THEN the canonical form lowercases the host so http://FOO.com and http://foo.com share a cache row
		expect(canonicalizeUrl('https://FOO.com/path')).toBe('https://foo.com/path')
	})

	it('should strip the fragment', () => {
		// GIVEN a URL with a fragment anchor (fragments never reach the server)
		// THEN the canonical form drops the fragment
		expect(canonicalizeUrl('https://example.com/a#section')).toBe(
			'https://example.com/a',
		)
	})

	it('should strip trailing slashes except on the root path', () => {
		// GIVEN a URL with a trailing slash on a non-root path
		expect(canonicalizeUrl('https://example.com/a/')).toBe(
			'https://example.com/a',
		)
		// AND a URL with only a root slash
		// THEN root's slash is preserved (empty path is not a valid URL)
		expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/')
	})

	it('should pass through unparseable strings unchanged', () => {
		// GIVEN a non-URL input
		// THEN the helper returns it verbatim — callers that passed bad data get the same key they would have generated
		expect(canonicalizeUrl('not a url')).toBe('not a url')
	})
})

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
