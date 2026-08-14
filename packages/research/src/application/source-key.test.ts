import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
	canonicalizeUrl,
	hostOf,
	isBareWebAddress,
	isWebAddress,
	pathOf,
	sourceIdFor,
	urlHashForScrape,
} from './source-key'

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

describe('hostOf', () => {
	describe('when comparing URLs by their site', () => {
		it('should reduce www, case, scheme, and path to the same host', () => {
			// GIVEN the same site written several ways a model might tidy it
			// THEN each reduces to the bare host
			expect(hostOf('https://www.Acme.es/contact')).toBe('acme.es')
			expect(hostOf('https://acme.es')).toBe('acme.es')
			expect(hostOf('http://ACME.es/a/b?x=1')).toBe('acme.es')
		})

		it('should resolve a scheme-less bare domain via a retry', () => {
			// GIVEN a tidied citation with no scheme (which `new URL` rejects)
			// WHEN parsed — THEN the retry with a scheme recovers the host
			expect(hostOf('monzo.com')).toBe('monzo.com')
			expect(hostOf('www.acme.es/careers')).toBe('acme.es')
		})

		it('should return null for text that is not a URL', () => {
			// GIVEN a non-URL citation (a title, prose)
			expect(hostOf('Monzo Bank plc')).toBeNull()
		})
	})
})

describe('pathOf', () => {
	describe('when telling namespaces apart on one host', () => {
		it('should return the lowercased path, with or without a scheme', () => {
			// GIVEN URLs that differ only by path — a person vs a company
			expect(pathOf('https://www.linkedin.com/in/Jane-Doe/')).toBe(
				'/in/jane-doe/',
			)
			expect(pathOf('https://www.linkedin.com/company/acme')).toBe(
				'/company/acme',
			)
			expect(pathOf('zoominfo.com/p/Someone/1')).toBe('/p/someone/1')
		})

		it('should return null for text that is not a URL', () => {
			expect(pathOf('just a title')).toBeNull()
		})
	})
})

describe('isWebAddress', () => {
	describe('when the string is a page somebody could open', () => {
		it('should accept it however the model tidied it', () => {
			// GIVEN the same site written with a scheme, without one, and with www
			// THEN each is an address worth fetching and worth placing by host
			expect(isWebAddress('https://acme.es/contact')).toBe(true)
			expect(isWebAddress('acme.es')).toBe(true)
			expect(isWebAddress('www.acme.es/careers')).toBe(true)
			expect(isWebAddress('HTTP://ACME.es/a/b?x=1')).toBe(true)
			expect(isWebAddress('https://careers.acme.co.uk:8443/x')).toBe(true)
		})

		it('should accept a non-Latin address, ending and all', () => {
			// GIVEN domains the parser hands back as punycode — one with a Latin
			// ending, one whose ending is non-Latin too
			expect(isWebAddress('ñandú.es')).toBe(true)
			expect(isWebAddress('пример.рф')).toBe(true)
			expect(isWebAddress('https://例え.テスト')).toBe(true)
			// The punycode is what the check actually sees, either way
			expect(isWebAddress('https://xn--e1afmkfd.xn--p1ai')).toBe(true)
		})

		it('should accept hosts spelled unusually rather than call them unreadable', () => {
			// GIVEN two legal but uncommon spellings — saying "not an address" here
			// would let a third party's page skip the confidence cap
			expect(isWebAddress('https://acme.es./about')).toBe(true)
			expect(isWebAddress('https://my_data.example.com/acme')).toBe(true)
		})
	})

	describe('when the string is one of our own source ids', () => {
		it('should reject it, so no run pays to fetch a page it already holds', () => {
			// GIVEN the id a harvested contact page is cited to
			const sourceId = sourceIdFor(urlHashForScrape('https://acme.es/contact'))

			// WHEN asked whether it is a web address
			// THEN no — even though gluing a scheme on the front parses it as a host
			expect(sourceId).toMatch(/^src_/)
			expect(isWebAddress(sourceId)).toBe(false)
			expect(hostOf(sourceId)).not.toBeNull()
		})
	})

	describe('when the string is not a web address', () => {
		it('should reject prose, empty text, and a bare word', () => {
			// GIVEN citations a model wrote as a title or left blank
			expect(isWebAddress('Monzo Bank plc')).toBe(false)
			expect(isWebAddress('')).toBe(false)
			expect(isWebAddress('   ')).toBe(false)
			// A single label is nothing on the public web
			expect(isWebAddress('localhost')).toBe(false)
			expect(isWebAddress('intranet')).toBe(false)
		})

		it('should reject a mailbox, so a gap round never fetches an address', () => {
			// GIVEN an email written bare and with its scheme — both would otherwise
			// read as the site acme.es
			expect(isWebAddress('info@acme.es')).toBe(false)
			expect(isWebAddress('mailto:info@acme.es')).toBe(false)
		})

		it('should reject a scheme no scraper opens', () => {
			// GIVEN a file or transfer URL rather than a page
			expect(isWebAddress('ftp://acme.es/pub')).toBe(false)
			expect(isWebAddress('file:///etc/hosts')).toBe(false)
		})

		it('should reject hosts that are not domain names', () => {
			// GIVEN a numeric host and a malformed one — neither is a site to judge
			expect(isWebAddress('https://192.168.1.1/x')).toBe(false)
			expect(isWebAddress('https://acme-.es')).toBe(false)
			expect(isWebAddress('https://acme.e')).toBe(false)
		})

		it('should keep reading an address with an aside next to it as an address', () => {
			// GIVEN a citation a model wrote with its own note glued on the end
			// THEN it is still an address here. Saying no would mean the page skips the
			// third-party confidence cap and the user-posted-content block, which is
			// the unsafe direction for grading a citation — `isBareWebAddress` is what
			// a website field asks instead
			expect(
				isWebAddress('https://acme.es/about (approximate, from the register)'),
			).toBe(true)
		})
	})
})

describe('isBareWebAddress', () => {
	describe('when the value is one address and nothing else', () => {
		it('should accept it, padded with blank space or carrying an escape', () => {
			// GIVEN one address typed with space either side — sloppy formatting, not
			// something written next to it
			expect(isBareWebAddress('  https://acme.es/contact  ')).toBe(true)
			// AND an escaped space inside a real path is part of the address
			expect(isBareWebAddress('https://acme.es/quienes%20somos')).toBe(true)
			expect(isBareWebAddress('acme.es')).toBe(true)
		})
	})

	describe('when something is written beside the address', () => {
		it('should reject it, however clean the host reads', () => {
			// GIVEN what a model hands back when it is unsure of a website: the address
			// with its own aside attached
			// THEN neither is one address. The parser folds the trailing words into the
			// path as escapes and yields a clean hostname, so a check that weighs the
			// host passes something nobody can open
			expect(
				isBareWebAddress(
					'https://adime.org/ (not directly provided, inferred from name)',
				),
			).toBe(false)
			expect(
				isBareWebAddress(
					'https://sea.es/ (derived from SEA Empresas Alavesas page)',
				),
			).toBe(false)
			expect(isBareWebAddress('Website: https://acme.es')).toBe(false)
			expect(isBareWebAddress('acme.es or acme.com')).toBe(false)
		})

		it('should still reject everything a web address is not', () => {
			// GIVEN the values the looser question already turns down
			expect(isBareWebAddress('info@acme.es')).toBe(false)
			expect(isBareWebAddress('ftp://acme.es/pub')).toBe(false)
			expect(isBareWebAddress('localhost')).toBe(false)
			expect(isBareWebAddress('')).toBe(false)
		})
	})
})
