import { describe, expect, it } from 'vitest'

import {
	constrainVocabulary,
	mapIndustry,
	mapRegion,
	mapSizeRange,
} from './vocabulary-guard'

describe('mapIndustry', () => {
	describe('when the text names a known sector in any of the three languages', () => {
		it('should map an English, Catalan, or Spanish label to the CRM code', () => {
			// GIVEN labels a page might use in English, Catalan, or Spanish
			// THEN each folds onto the same code
			expect(mapIndustry('Bicycle Manufacturing Ltd')).toBe('manufactura')
			expect(mapIndustry('restauració')).toBe('restauració')
			expect(mapIndustry('empresa de logística')).toBe('transport')
			expect(mapIndustry('digital banking')).toBe('serveis')
			expect(mapIndustry('activewear & apparel')).toBe('retail')
		})
	})

	describe('when the text is a real but uncategorized industry', () => {
		it('should fall to other rather than blank a plausible label', () => {
			// GIVEN a genuine industry that fits no bucket
			// THEN it maps to 'other', never dropped
			expect(mapIndustry('agriculture')).toBe('other')
			expect(mapIndustry('mining group')).toBe('other')
		})
	})

	describe('when the text is not an industry at all', () => {
		it('should blank a URL, an email, a placeholder, or a sentence to null', () => {
			// GIVEN junk the model sometimes emits for a field it could not fill
			// THEN each is blanked so it never reaches the CRM
			expect(mapIndustry('https://acme.com')).toBeNull()
			expect(mapIndustry('info@acme.com')).toBeNull()
			expect(mapIndustry('N/A')).toBeNull()
			expect(
				mapIndustry('We are a company that does many things across sectors'),
			).toBeNull()
			expect(mapIndustry('')).toBeNull()
		})
	})
})

describe('mapRegion', () => {
	describe('when the text names a place in the CRM regional domain', () => {
		it('should map a province or region name to its code', () => {
			// GIVEN place names inside Catalonia, Aragon, or the Valencian Community
			expect(mapRegion('Catalonia')).toBe('cat')
			expect(mapRegion('Barcelona')).toBe('cat')
			expect(mapRegion('Zaragoza')).toBe('ara')
			expect(mapRegion('Comunitat Valenciana')).toBe('cv')
			expect(mapRegion('Alicante')).toBe('cv')
		})
	})

	describe('when the text is already a code', () => {
		it('should pass an exact code through', () => {
			// GIVEN a value that is already a CRM code
			expect(mapRegion('cat')).toBe('cat')
		})
	})

	describe('when the place is outside the CRM regional domain', () => {
		it('should return null so region stays empty', () => {
			// GIVEN a place the CRM has no region for
			expect(mapRegion('Madrid')).toBeNull()
			expect(mapRegion('London')).toBeNull()
		})
	})
})

describe('mapSizeRange', () => {
	describe('when the text is an exact bucket', () => {
		it('should keep it', () => {
			// GIVEN a value that already matches a bucket
			expect(mapSizeRange('11-25')).toBe('11-25')
		})
	})

	describe('when the text is a head-count or a range', () => {
		it('should bucket the first integer', () => {
			// GIVEN a head-count or a range in words
			expect(mapSizeRange('50 employees')).toBe('26-50')
			expect(mapSizeRange('12')).toBe('11-25')
			expect(mapSizeRange('10 to 20 staff')).toBe('6-10')
			expect(mapSizeRange('3')).toBe('1-5')
		})

		it('should fall a value above the top bucket to the closest one', () => {
			// GIVEN a company larger than the top bracket
			expect(mapSizeRange('500')).toBe('51-200')
		})
	})

	describe('when the size is qualitative or junk', () => {
		it('should blank it to null', () => {
			// GIVEN a size with no head-count
			expect(mapSizeRange('SME')).toBeNull()
			expect(mapSizeRange('small')).toBeNull()
			expect(mapSizeRange('N/A')).toBeNull()
		})
	})
})

describe('constrainVocabulary', () => {
	describe('when an enrichment block holds mappable and junk values', () => {
		it('should rewrite the mappable ones, drop the junk key, and count both', () => {
			// GIVEN an enrichment block mixing mappable values, an out-of-domain
			// region, and an untouched free-text field
			const findings = {
				enrichment: {
					industry: 'freight & logistics',
					region: 'Madrid',
					size_range: '50 employees',
					pain_points: 'high churn',
				},
			}

			// WHEN constrained to the CRM codes
			const result = constrainVocabulary(findings)

			// THEN mappable values become codes, the out-of-domain region key is
			// dropped, the free-text field is untouched, and the counters are accurate
			const e = (result.findings as { enrichment: Record<string, unknown> })
				.enrichment
			expect(e['industry']).toBe('transport')
			expect(e['size_range']).toBe('26-50')
			expect(e).not.toHaveProperty('region')
			expect(e['pain_points']).toBe('high churn')
			expect(result.mapped).toBe(2)
			expect(result.blanked).toBe(1)
		})
	})

	describe('when a target field sits inside a proposed update', () => {
		it('should map it there too and drop a junk field, emptying the proposal', () => {
			// GIVEN a proposal whose only field is a junk industry
			const findings = {
				proposed_updates: [
					{ subject_id: 'c1', fields: { industry: 'https://junk' } },
				],
			}

			// WHEN constrained
			const result = constrainVocabulary(findings)

			// THEN the junk key is gone, leaving an empty fields object the
			// applicability guard drops next
			const p = (
				result.findings as {
					proposed_updates: Array<{ fields: Record<string, unknown> }>
				}
			).proposed_updates
			expect(p[0]?.fields).toEqual({})
			expect(result.blanked).toBe(1)
		})
	})

	describe('when a field is a { value, source_id } wrapper', () => {
		it('should map the inner value and preserve the wrapper', () => {
			// GIVEN a per-field sourced wrapper (the citations slice's shape)
			const findings = {
				enrichment: {
					industry: { value: 'apparel retailer', source_id: 's1' },
				},
			}

			// WHEN constrained
			const result = constrainVocabulary(findings)

			// THEN the inner value becomes a code and the source rides along
			const e = (result.findings as { enrichment: { industry: unknown } })
				.enrichment
			expect(e.industry).toEqual({ value: 'retail', source_id: 's1' })
			expect(result.mapped).toBe(1)
		})
	})

	describe('when findings is not a plain object', () => {
		it('should return degenerate inputs unchanged with zero counters', () => {
			// GIVEN null, a primitive, and an array
			// THEN each is returned untouched with no mapping
			expect(constrainVocabulary(null)).toEqual({
				findings: null,
				mapped: 0,
				blanked: 0,
			})
			expect(constrainVocabulary('x')).toEqual({
				findings: 'x',
				mapped: 0,
				blanked: 0,
			})
			expect(constrainVocabulary([1, 2]).findings).toEqual([1, 2])
		})
	})
})
