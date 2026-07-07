import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	AcceptedCountry,
	isRegistryCountry,
	parseCountryAlpha2,
	REGISTRY_COUNTRIES,
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

		it('should accept any case and preserve it (the handler normalizes)', () => {
			// GIVEN a lower- or mixed-case code
			// WHEN it is decoded
			// THEN the boundary leaves case untouched — upper-casing is the handler's job
			expect(decodeCountry('gb')).toBe('gb')
			expect(decodeCountry('Us')).toBe('Us')
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
