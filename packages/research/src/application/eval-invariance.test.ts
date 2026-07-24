import { describe, expect, it } from 'vitest'

import { compareFramings, type FramingOutcome } from './eval-invariance'

const outcome = (over: Partial<FramingOutcome>): FramingOutcome => ({
	fields: { industry: 'transport', size_range: '11-50' },
	entityMatch: 'strong',
	contacts: [{ name: 'Ada Puig' }],
	...over,
})

describe('compareFramings', () => {
	describe('when both framings report the same facts', () => {
		it('should hold the invariant across case and whitespace noise', () => {
			// GIVEN the same company under two framings, values differing only in case
			const a = outcome({})
			const b = outcome({
				fields: { industry: ' Transport ', size_range: '11-50' },
				contacts: [{ name: 'ada puig' }],
			})

			// WHEN compared — THEN nothing diverges
			const result = compareFramings(a, b)
			expect(result.invariant).toBe(true)
			expect(result.divergentFields).toEqual([])
			expect(result.contactsOnlyInA).toEqual([])
		})
	})

	describe('when a framing bends a firmographic', () => {
		it('should name the divergent field and break the invariant', () => {
			// GIVEN the size band shifting with the framing — the leak the eval hunts
			const a = outcome({})
			const b = outcome({
				fields: { industry: 'transport', size_range: '201-500' },
			})

			// WHEN compared — THEN the leak is named
			const result = compareFramings(a, b)
			expect(result.invariant).toBe(false)
			expect(result.divergentFields).toEqual(['size_range'])
		})
	})

	describe('when the entity verdict or the people change with the framing', () => {
		it('should flag the verdict divergence', () => {
			// GIVEN one framing landing weak where the other landed strong
			const result = compareFramings(
				outcome({}),
				outcome({ entityMatch: 'weak' }),
			)
			// THEN the invariant breaks on the verdict
			expect(result.entityMatchDiverged).toBe(true)
			expect(result.invariant).toBe(false)
		})

		it('should list a contact that only one framing returned', () => {
			// GIVEN a "large-company" framing conjuring an extra executive
			const result = compareFramings(
				outcome({}),
				outcome({ contacts: [{ name: 'Ada Puig' }, { name: 'Big Exec' }] }),
			)
			// THEN the framing-only person is listed and the invariant breaks
			expect(result.contactsOnlyInB).toEqual(['big exec'])
			expect(result.invariant).toBe(false)
		})
	})

	describe('when a field is unfilled on both sides', () => {
		it('should treat null, empty, and absent as agreeing', () => {
			// GIVEN one side null and the other simply missing the key
			const result = compareFramings(
				outcome({ fields: { industry: null } }),
				outcome({ fields: {} }),
			)
			// THEN absence agrees with absence
			expect(result.divergentFields).toEqual([])
		})
	})
})
