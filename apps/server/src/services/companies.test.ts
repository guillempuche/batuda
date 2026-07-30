import { describe, expect, it } from 'vitest'

import { normalizeTaxId } from './companies'

describe('normalizeTaxId', () => {
	describe('when the same number is written three different ways', () => {
		it('should reduce all of them to one comparable value', () => {
			// GIVEN the spellings of one Spanish CIF found across three pages
			const spellings = ['B12345678', 'B-12345678', 'b 12345678']

			// WHEN each is normalized
			const normalized = spellings.map(normalizeTaxId)

			// THEN they are the same value, so the company is recognised as one
			expect(new Set(normalized).size).toBe(1)
			expect(normalized[0]).toBe('B12345678')
		})
	})

	describe('when the number carries a country prefix or punctuation', () => {
		it('should keep the letters and digits and drop everything else', () => {
			// GIVEN a VAT number written with a space, and a UK number with dots
			expect(normalizeTaxId('ES B12345678')).toBe('ESB12345678')
			expect(normalizeTaxId('12.345.678')).toBe('12345678')
			expect(normalizeTaxId('SC-123/456')).toBe('SC123456')
		})
	})

	describe('when two genuinely different numbers are compared', () => {
		it('should keep them apart', () => {
			// GIVEN a prefixed and an unprefixed number — the prefix is part of the
			// identity, so stripping punctuation must not merge these
			expect(normalizeTaxId('ESB12345678')).not.toBe(
				normalizeTaxId('B12345678'),
			)
		})
	})

	describe('when there is nothing identifying left', () => {
		it('should reduce to empty, which is what marks it unusable', () => {
			// GIVEN values a model or a person might leave in the field
			expect(normalizeTaxId('')).toBe('')
			expect(normalizeTaxId('   ')).toBe('')
			expect(normalizeTaxId('--')).toBe('')
			expect(normalizeTaxId('  -/. ')).toBe('')
		})
	})
})
