import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	AcceptedCountry,
	isRegistryCountry,
	parseCountryAlpha2,
	REGISTRY_COUNTRIES,
	registryCountryForHost,
	resolveRegistryCountry,
} from './country'

const decodeCountry = Schema.decodeUnknownSync(AcceptedCountry)

describe('AcceptedCountry', () => {
	describe('when the value is a two-letter code', () => {
		it('should accept a registry country', () => {
			// GIVEN a supported alpha-2 code
			// WHEN it is decoded
			// THEN it passes through unchanged
			expect(decodeCountry('ES')).toBe('ES')
		})

		it('should accept any ISO country, not only registry ones', () => {
			// GIVEN countries with no national registry
			// WHEN they are decoded
			// THEN they are still accepted — targeting is decoupled from has-a-registry
			expect(decodeCountry('US')).toBe('US')
			expect(decodeCountry('FR')).toBe('FR')
		})

		it('should accept any case and raise it to capitals', () => {
			// GIVEN a lower- or mixed-case code
			// WHEN it is decoded
			// THEN it comes back in capitals, the one spelling everything downstream
			// compares against — a company stored lower-case is missed by anyone
			// asking for the capitals, and counted as a country of its own
			expect(decodeCountry('gb')).toBe('GB')
			expect(decodeCountry('Us')).toBe('US')
		})
	})

	describe('when the value is not a two-letter alpha code', () => {
		it('should reject anything that is not exactly two letters', () => {
			// GIVEN inputs that are not a two-letter alpha code
			// WHEN each is decoded
			// THEN each is rejected
			expect(() => decodeCountry('')).toThrow()
			expect(() => decodeCountry('E')).toThrow()
			expect(() => decodeCountry('ESP')).toThrow()
			expect(() => decodeCountry('E1')).toThrow()
		})
	})
})

describe('isRegistryCountry', () => {
	describe('when the code has a national registry adapter', () => {
		it('should recognize every REGISTRY_COUNTRIES entry', () => {
			// GIVEN the closed registry set
			// WHEN each entry is checked
			// THEN all are recognized
			for (const cc of REGISTRY_COUNTRIES) {
				expect(isRegistryCountry(cc)).toBe(true)
			}
		})
	})

	describe('when the code has no registry adapter', () => {
		it('should not recognize a registry-less country', () => {
			// GIVEN a country with no national registry adapter
			// WHEN it is checked
			// THEN it is not recognized
			expect(isRegistryCountry('US')).toBe(false)
			expect(isRegistryCountry('FR')).toBe(false)
		})

		it('should not recognize a non-normalized (lowercase) code', () => {
			// GIVEN callers upper-case before calling, so the guard is exact-match
			// WHEN a lowercase registry code is checked
			// THEN it is not recognized
			expect(isRegistryCountry('es')).toBe(false)
		})
	})
})

describe('parseCountryAlpha2', () => {
	describe('when the hint is already a two-letter code', () => {
		it('should upper-case it', () => {
			// GIVEN a bare alpha-2 in either case
			// WHEN it is parsed
			// THEN it is normalized to upper-case (adapters re-case per API)
			expect(parseCountryAlpha2('US')).toBe('US')
			expect(parseCountryAlpha2('us')).toBe('US')
			expect(parseCountryAlpha2('es')).toBe('ES')
		})

		it('should ignore surrounding whitespace', () => {
			// GIVEN a code padded with spaces
			// WHEN it is parsed
			// THEN the code is trimmed and upper-cased
			expect(parseCountryAlpha2('  gb ')).toBe('GB')
		})

		it('should accept any two letters without an ISO lookup', () => {
			// GIVEN a two-letter token that is not a real country (e.g. a language)
			// WHEN it is parsed
			// THEN it still passes through, matching AcceptedCountry's shape-only
			// rule — we deliberately ship no country table (the model sends valid
			// hints), so this is a known, documented limitation
			expect(parseCountryAlpha2('en')).toBe('EN')
		})
	})

	describe('when the hint is a language-and-region locale', () => {
		it('should keep only the region subtag', () => {
			// GIVEN a locale the model commonly sends (the exact 422 trigger)
			// WHEN it is parsed
			// THEN just the region is kept, upper-cased — never the whole locale
			expect(parseCountryAlpha2('en-US')).toBe('US')
			expect(parseCountryAlpha2('es-ES')).toBe('ES')
			expect(parseCountryAlpha2('es_ES')).toBe('ES')
		})
	})

	describe('when the hint is not a recognizable country', () => {
		it('should drop it so no invalid country reaches the search API', () => {
			// GIVEN a full name, a language-only tag, junk, empty, or missing input
			// WHEN each is parsed
			// THEN nothing is returned and the caller omits the country param
			expect(parseCountryAlpha2('United States')).toBeUndefined()
			expect(parseCountryAlpha2('USA')).toBeUndefined()
			expect(parseCountryAlpha2('123')).toBeUndefined()
			expect(parseCountryAlpha2('')).toBeUndefined()
			expect(parseCountryAlpha2(undefined)).toBeUndefined()
		})
	})
})

describe('registryCountryForHost', () => {
	describe('when the host ends in a registry country code', () => {
		it('should map .uk and .co.uk to GB and .es to ES', () => {
			// GIVEN hosts on a country-code suffix
			// THEN each resolves to the country whose register we can query
			expect(registryCountryForHost('acme.co.uk')).toBe('GB')
			expect(registryCountryForHost('acme.uk')).toBe('GB')
			expect(registryCountryForHost('empresa.es')).toBe('ES')
		})
	})

	describe('when the host is a .com or has no usable suffix', () => {
		it('should resolve to nothing rather than guess', () => {
			// GIVEN a .com host — plenty of Spanish and British companies use one
			expect(registryCountryForHost('gruposese.com')).toBeUndefined()
			expect(registryCountryForHost(undefined)).toBeUndefined()
		})
	})
})

describe('resolveRegistryCountry', () => {
	describe('when the company on file records its country', () => {
		it('should use the stored country over a weaker signal', () => {
			// GIVEN a company on file in ES, a hint pointing at GB, and a .com site
			const cc = resolveRegistryCountry({
				subjectCountry: 'ES',
				locationHint: 'GB',
				anchorHost: 'acme.com',
			})

			// THEN the surest signal — what we already recorded — wins
			expect(cc).toBe('ES')
		})
	})

	describe('when there is no stored country but a place hint', () => {
		it('should fall back to the hint', () => {
			// GIVEN no stored country, a GB hint
			const cc = resolveRegistryCountry({
				subjectCountry: undefined,
				locationHint: 'GB',
				anchorHost: 'acme.com',
			})

			// THEN the hint routes the lookup
			expect(cc).toBe('GB')
		})
	})

	describe('when only the web address carries a country signal', () => {
		it('should fall back to the address suffix', () => {
			// GIVEN nothing but a .es site
			const cc = resolveRegistryCountry({
				subjectCountry: undefined,
				locationHint: undefined,
				anchorHost: 'empresa.es',
			})

			// THEN the suffix is the last resort
			expect(cc).toBe('ES')
		})
	})

	describe('when a signal names a country with no register we can query', () => {
		it('should skip it and try the next signal', () => {
			// GIVEN a stored country (US) with no adapter, then a usable ES hint
			const cc = resolveRegistryCountry({
				subjectCountry: 'US',
				locationHint: 'ES',
				anchorHost: undefined,
			})

			// THEN it passes over the unqueryable country to the one we can look up
			expect(cc).toBe('ES')
		})
	})

	describe('when nothing points at a queryable register', () => {
		it('should resolve to nothing, so no lookup is forced', () => {
			// GIVEN a US company on a .com with no hint
			const cc = resolveRegistryCountry({
				subjectCountry: 'US',
				locationHint: undefined,
				anchorHost: 'acme.com',
			})

			// THEN no register is consulted rather than guessing one
			expect(cc).toBeUndefined()
		})
	})
})
