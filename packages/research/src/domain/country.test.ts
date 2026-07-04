import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	AcceptedCountry,
	isRegistryCountry,
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
