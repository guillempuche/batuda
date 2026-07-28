import { describe, expect, it } from 'vitest'

import {
	contactFill,
	ENRICHMENT_FIELDS,
	enrichmentFill,
	hasTitle,
} from './extraction-fill'

// A per-field wrapper as the model emits it: a value plus the source backing it.
const sourced = (value: string) => ({
	value,
	source_id: 's1',
	confidence: null,
})

describe('ENRICHMENT_FIELDS', () => {
	it('should list the six company-profile fields, from the schema itself', () => {
		// GIVEN the field list derived from the enrichment schema
		// THEN it is exactly the six the model is asked to fill
		expect([...ENRICHMENT_FIELDS].sort()).toEqual([
			'country',
			'current_tools',
			'industry',
			'location',
			'size_range',
			'tags',
		])
	})
})

describe('enrichmentFill', () => {
	describe('when the model returned nothing', () => {
		it('should count zero filled — the empty answer made visible', () => {
			// GIVEN the dominant failure: an enrichment that decoded to no keys
			const result = enrichmentFill({ enrichment: {} })

			// THEN every field is missing and none is filled
			expect(result.total).toBe(6)
			expect(result.filled).toBe(0)
			expect(result.missing.length).toBe(6)
		})
	})

	describe('when some fields carry a value and others do not', () => {
		it('should count only the ones with a real value', () => {
			// GIVEN a mix of filled scalar fields and an empty list
			const result = enrichmentFill({
				enrichment: {
					industry: sourced('logistics'),
					size_range: sourced('51-200'),
					tags: [],
				},
			})

			// THEN the two with content count, the empty list and the absent
			// fields do not
			expect(result.filled).toBe(2)
			expect(result.missing).toContain('tags')
			expect(result.missing).toContain('location')
		})
	})

	describe('when a field was emptied to null by a guard', () => {
		it('should count it as unfilled, not as present', () => {
			// GIVEN a field a guard nulled — the value is gone but the key remains
			const result = enrichmentFill({
				enrichment: { industry: { value: null, source_id: 's1' } },
			})

			// THEN it does not count toward the fill
			expect(result.filled).toBe(0)
			expect(result.missing).toContain('industry')
		})
	})

	describe('when the findings are degenerate', () => {
		it('should treat a missing or non-object enrichment as all-empty', () => {
			// GIVEN findings with no enrichment block, or none at all
			// THEN nothing is filled rather than throwing
			expect(enrichmentFill({}).filled).toBe(0)
			expect(enrichmentFill(null).filled).toBe(0)
			expect(enrichmentFill('text').filled).toBe(0)
		})
	})
})

describe('hasTitle', () => {
	describe('when the contact carries a role value', () => {
		it('should report a title', () => {
			// GIVEN a contact with a real role
			expect(hasTitle({ name: 'Ada', role: sourced('CTO') })).toBe(true)
		})
	})

	describe('when the role is absent, empty, or guard-nulled', () => {
		it('should report no title', () => {
			// GIVEN the shapes a titleless contact takes
			expect(hasTitle({ name: 'Ada' })).toBe(false)
			expect(hasTitle({ name: 'Ada', role: sourced('  ') })).toBe(false)
			expect(
				hasTitle({ name: 'Ada', role: { value: null, source_id: 's1' } }),
			).toBe(false)
			expect(hasTitle(null)).toBe(false)
		})
	})
})

describe('contactFill', () => {
	describe('when contacts come back named but without titles', () => {
		it('should count the named and, separately, the titled', () => {
			// GIVEN the Lectra symptom: several named people, none with a role
			const result = contactFill({
				contacts: [
					{ name: 'Ada Lovelace' },
					{ name: 'Alan Turing' },
					{ name: 'Grace Hopper', role: sourced('CEO') },
				],
			})

			// THEN all three are named but only the one with a role is titled
			expect(result.named).toBe(3)
			expect(result.titled).toBe(1)
		})
	})

	describe('when an entry has no usable name', () => {
		it('should not count it', () => {
			// GIVEN a blank-named entry among real ones
			const result = contactFill({
				contacts: [{ name: '' }, { name: 'Ada', role: sourced('CTO') }],
			})

			// THEN only the real, named contact counts
			expect(result.named).toBe(1)
			expect(result.titled).toBe(1)
		})
	})

	describe('when there are no contacts', () => {
		it('should count zero rather than throwing', () => {
			// GIVEN findings with no contacts array
			expect(contactFill({ enrichment: {} }).named).toBe(0)
			expect(contactFill(null).named).toBe(0)
		})
	})
})
