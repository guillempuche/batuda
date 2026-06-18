import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { canonicalizeUrl, urlHashForScrape } from './source-key'

describe('canonicalizeUrl', () => {
	it('should lowercase the hostname', () => {
		// GIVEN a URL with a mixed-case host
		// THEN the host is lowercased so FOO.com and foo.com share one cache row
		expect(canonicalizeUrl('https://FOO.com/path')).toBe('https://foo.com/path')
	})

	it('should lowercase the scheme', () => {
		// GIVEN an upper-case scheme (WHATWG URL lowercases it)
		// THEN the canonical form is lower-case
		expect(canonicalizeUrl('HTTPS://Example.com/')).toBe('https://example.com/')
	})

	it('should strip the fragment', () => {
		// GIVEN a URL with a fragment anchor (fragments never reach the server)
		// THEN the canonical form drops the fragment
		expect(canonicalizeUrl('https://example.com/a#section')).toBe(
			'https://example.com/a',
		)
	})

	it('should strip a trailing slash on a non-root path', () => {
		// GIVEN a non-root path with a trailing slash
		// THEN the trailing slash is removed
		expect(canonicalizeUrl('https://example.com/a/')).toBe(
			'https://example.com/a',
		)
	})

	it('should remove only the final slash when several trail', () => {
		// GIVEN a path ending in more than one slash
		// THEN only the last slash is trimmed (minimal canonicalization)
		expect(canonicalizeUrl('https://example.com/a//')).toBe(
			'https://example.com/a/',
		)
	})

	it('should preserve the root slash', () => {
		// GIVEN a URL whose only path is the root slash
		// THEN it is preserved (an empty path is not a valid URL)
		expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/')
	})

	it('should preserve the query string', () => {
		// GIVEN a URL carrying a query (WHATWG URL inserts the root path)
		// THEN the query survives canonicalization
		expect(canonicalizeUrl('https://example.com?a=1')).toBe(
			'https://example.com/?a=1',
		)
	})

	it('should preserve an explicit port', () => {
		// GIVEN a URL with a non-default port
		// THEN the port is kept (it changes which server answers)
		expect(canonicalizeUrl('https://example.com:8080/path')).toBe(
			'https://example.com:8080/path',
		)
	})

	it('should preserve userinfo', () => {
		// GIVEN a URL embedding userinfo (kept password-free so the fixture
		// doesn't read as a basic-auth credential to the secret scanner)
		// THEN the userinfo is left intact
		expect(canonicalizeUrl('https://user@example.com/')).toBe(
			'https://user@example.com/',
		)
	})

	it('should punycode an internationalized host', () => {
		// GIVEN a URL with non-ASCII host characters
		// THEN the host is encoded to punycode by the WHATWG parser
		expect(canonicalizeUrl('https://café.com/')).toBe(
			'https://xn--caf-dma.com/',
		)
	})

	it('should pass a non-http scheme through the same rules', () => {
		// GIVEN a parseable non-http URL
		// THEN it is canonicalized like any other (no scheme allow-list)
		expect(canonicalizeUrl('ftp://example.com/file')).toBe(
			'ftp://example.com/file',
		)
	})

	it('should return an unparseable string unchanged', () => {
		// GIVEN input the URL parser rejects
		// THEN the helper returns it verbatim — a bad URL still yields a stable key
		expect(canonicalizeUrl('not a url')).toBe('not a url')
	})
})

describe('urlHashForScrape', () => {
	it('should produce a 64-char lowercase hex sha256', () => {
		// GIVEN any URL
		// THEN the key is a sha256 hex digest, the shape the sources table is keyed by
		expect(urlHashForScrape('https://example.com/a')).toMatch(/^[0-9a-f]{64}$/)
	})

	it('should be the sha256 of the canonical URL', () => {
		// GIVEN a URL and its canonical form
		// THEN the key equals sha256(canonical) so attribution and the cache agree
		const expected = createHash('sha256')
			.update(canonicalizeUrl('https://Example.com/a/'))
			.digest('hex')
		expect(urlHashForScrape('https://Example.com/a/')).toBe(expected)
	})

	it('should be deterministic for the same input', () => {
		// GIVEN the same URL hashed twice
		// THEN both calls return the identical key
		expect(urlHashForScrape('https://example.com/a')).toBe(
			urlHashForScrape('https://example.com/a'),
		)
	})

	it('should collapse canonicalization-equivalent URLs to one key', () => {
		// GIVEN two URLs differing only by host case and a trailing slash
		// THEN they hash identically so the same page is not fetched twice
		expect(urlHashForScrape('https://FOO.com/a/')).toBe(
			urlHashForScrape('https://foo.com/a'),
		)
	})

	it('should distinguish genuinely different URLs', () => {
		// GIVEN two distinct paths
		// THEN their keys differ so unrelated pages are not deduplicated
		expect(urlHashForScrape('https://example.com/a')).not.toBe(
			urlHashForScrape('https://example.com/b'),
		)
	})
})
