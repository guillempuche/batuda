import { describe, expect, it } from 'vitest'

import { countActiveCompanies, countActiveIn } from './pipeline-counts'

describe('countActiveCompanies', () => {
	describe('when the pipeline holds companies at several stages', () => {
		it('should add up every stage still being worked', () => {
			// GIVEN companies spread across the open stages
			const counts = { prospect: 4, contacted: 3, meeting: 2, client: 1 }

			// WHEN counting the active ones
			// THEN every stage contributes
			expect(countActiveCompanies(counts)).toBe(10)
		})

		it('should leave out the ones nobody is working any more', () => {
			// GIVEN two open companies alongside a closed and a dead one
			const counts = { prospect: 2, closed: 5, dead: 3 }

			// WHEN counting the active ones
			// THEN only the open ones count
			expect(countActiveCompanies(counts)).toBe(2)
		})
	})

	describe('when there is nothing to count', () => {
		it('should report none for an empty pipeline', () => {
			expect(countActiveCompanies({})).toBe(0)
		})

		it('should report none when every company is closed or dead', () => {
			// GIVEN a pipeline where nothing is in play
			// THEN the count is zero rather than the row total
			expect(countActiveCompanies({ closed: 7, dead: 2 })).toBe(0)
		})
	})

	describe('when the snapshot carries an unfamiliar stage', () => {
		it('should count it as active rather than dropping it', () => {
			// GIVEN a stage this build does not know about
			// THEN it still counts, so a new stage cannot silently vanish
			expect(countActiveCompanies({ prospect: 1, negotiating: 2 })).toBe(3)
		})
	})
})

describe('countActiveIn', () => {
	describe('when given companies already in hand', () => {
		it('should apply the same rule as the snapshot count', () => {
			// GIVEN a mixed list
			const companies = [
				{ status: 'prospect' },
				{ status: 'client' },
				{ status: 'closed' },
				{ status: 'dead' },
			]

			// THEN only the two still in play count
			expect(countActiveIn(companies)).toBe(2)
		})

		it('should report none for an empty list', () => {
			expect(countActiveIn([])).toBe(0)
		})
	})
})
