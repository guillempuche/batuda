import { describe, expect, it } from 'vitest'

import { markRowsOutsideSize } from './prospect-size-mark'
import { MARKS_FIELD, OUTSIDE_REQUESTED_SIZE } from './row-marks'

const sized = (name: string, employees: number | null | undefined) => ({
	name,
	...(employees === undefined
		? {}
		: {
				employee_estimate: {
					value: employees,
					source_id: 'https://example.test/about',
				},
			}),
})

const prospects = (findings: unknown): ReadonlyArray<Record<string, unknown>> =>
	(findings as { prospects: ReadonlyArray<Record<string, unknown>> }).prospects

describe('markRowsOutsideSize', () => {
	describe('when the request wrote a band and a row states a headcount', () => {
		it('should mark the rows outside the band and leave the rest alone', () => {
			// GIVEN a request for 5 to 250 employees and rows above, inside and below
			const findings = {
				prospects: [
					sized('Too big', 400),
					sized('Just right', 40),
					sized('Too small', 2),
					sized('At the ceiling', 250),
				],
			}

			// WHEN the final list is marked
			const result = markRowsOutsideSize(findings, 'prospects', {
				minEmployees: 5,
				maxEmployees: 250,
			})

			// THEN the two outside carry the mark and the two inside carry nothing
			const rows = prospects(result.findings)
			expect(rows[0]?.[MARKS_FIELD]).toEqual([OUTSIDE_REQUESTED_SIZE])
			expect(rows[1]?.[MARKS_FIELD]).toBeUndefined()
			expect(rows[2]?.[MARKS_FIELD]).toEqual([OUTSIDE_REQUESTED_SIZE])
			expect(rows[3]?.[MARKS_FIELD]).toBeUndefined()
			expect(result.marked).toBe(2)
		})

		it('should hold a row to one bound when the request set only that one', () => {
			// GIVEN a floor alone
			const findings = { prospects: [sized('Small', 3), sized('Large', 900)] }

			// WHEN marked — THEN only the row under the floor is marked
			const result = markRowsOutsideSize(findings, 'prospects', {
				minEmployees: 10,
			})
			const rows = prospects(result.findings)
			expect(rows[0]?.[MARKS_FIELD]).toEqual([OUTSIDE_REQUESTED_SIZE])
			expect(rows[1]?.[MARKS_FIELD]).toBeUndefined()
		})

		it('should add the mark beside the marks a row already carries', () => {
			// GIVEN a row the existence check already doubted
			const findings = {
				prospects: [
					{
						...sized('Doubted', 1000),
						[MARKS_FIELD]: ['existence_unconfirmed'],
					},
				],
			}

			// WHEN marked — THEN both marks are on it, the earlier one first
			const result = markRowsOutsideSize(findings, 'prospects', {
				maxEmployees: 250,
			})
			expect(prospects(result.findings)[0]?.[MARKS_FIELD]).toEqual([
				'existence_unconfirmed',
				OUTSIDE_REQUESTED_SIZE,
			])
		})

		it('should not mark a row twice', () => {
			// GIVEN a row already carrying the mark, as a cached answer would
			const findings = {
				prospects: [
					{ ...sized('Marked', 1000), [MARKS_FIELD]: [OUTSIDE_REQUESTED_SIZE] },
				],
			}

			// WHEN marked again — THEN the list is as it was and nothing is counted
			const result = markRowsOutsideSize(findings, 'prospects', {
				maxEmployees: 250,
			})
			expect(result.findings).toBe(findings)
			expect(result.marked).toBe(0)
		})
	})

	describe('at the edges of the band', () => {
		it('should mark one below the floor and not the floor itself', () => {
			// GIVEN a floor of 5 and rows at 5 and 4
			const findings = { prospects: [sized('At', 5), sized('Below', 4)] }
			// WHEN marked — THEN only the one below carries the mark
			const rows = prospects(
				markRowsOutsideSize(findings, 'prospects', { minEmployees: 5 })
					.findings,
			)
			expect(rows[0]?.[MARKS_FIELD]).toBeUndefined()
			expect(rows[1]?.[MARKS_FIELD]).toEqual([OUTSIDE_REQUESTED_SIZE])
		})

		it('should hold a row to a ceiling when there is no floor', () => {
			// GIVEN a ceiling and no floor
			const findings = { prospects: [sized('Small', 3), sized('Large', 900)] }
			// WHEN marked — THEN only the row above the ceiling is marked
			const rows = prospects(
				markRowsOutsideSize(findings, 'prospects', { maxEmployees: 10 })
					.findings,
			)
			expect(rows[0]?.[MARKS_FIELD]).toBeUndefined()
			expect(rows[1]?.[MARKS_FIELD]).toEqual([OUTSIDE_REQUESTED_SIZE])
		})

		it('should leave a headcount that is not a number alone', () => {
			// GIVEN a value the shape allows but no page could state
			const findings = {
				prospects: [
					{
						name: 'Odd',
						employee_estimate: { value: Number.NaN, source_id: 'x' },
					},
				],
			}
			// WHEN marked — THEN it is neither inside nor outside, so untouched
			const result = markRowsOutsideSize(findings, 'prospects', {
				maxEmployees: 250,
			})
			expect(result.findings).toBe(findings)
		})
	})

	describe('when the marks field is not a list of words', () => {
		it('should keep the words and drop the rest when it adds the mark', () => {
			// GIVEN a row whose marks hold a number beside a word, and one whose
			// marks are a bare string
			const findings = {
				prospects: [
					{
						...sized('Mixed', 900),
						[MARKS_FIELD]: [1, 'existence_unconfirmed'],
					},
					{ ...sized('Bare', 900), [MARKS_FIELD]: 'outside_requested_size' },
				],
			}
			// WHEN marked — THEN each ends with a clean list carrying the mark
			const rows = prospects(
				markRowsOutsideSize(findings, 'prospects', { maxEmployees: 250 })
					.findings,
			)
			expect(rows[0]?.[MARKS_FIELD]).toEqual([
				'existence_unconfirmed',
				OUTSIDE_REQUESTED_SIZE,
			])
			expect(rows[1]?.[MARKS_FIELD]).toEqual([OUTSIDE_REQUESTED_SIZE])
		})
	})

	describe('when there is nothing to hold a row to, or nothing to hold', () => {
		it('should leave a row that states no headcount alone', () => {
			// GIVEN rows with no headcount, a blanked one, and a bare value
			const findings = {
				prospects: [
					sized('Silent', undefined),
					sized('Blanked', null),
					{ name: 'Bare', employee_estimate: 900 },
				],
			}

			// WHEN marked — THEN silence is not a finding, and a bare number is
			// not the paired shape the list carries
			const result = markRowsOutsideSize(findings, 'prospects', {
				maxEmployees: 250,
			})
			expect(result.findings).toBe(findings)
			expect(result.marked).toBe(0)
		})

		it('should do nothing when the request wrote no band', () => {
			// GIVEN a row far outside any band, and no band
			const findings = { prospects: [sized('Large', 9000)] }
			// WHEN marked — THEN untouched
			expect(markRowsOutsideSize(findings, 'prospects', {})).toEqual({
				findings,
				marked: 0,
			})
		})

		it('should do nothing when the answer has no list to mark', () => {
			// GIVEN no list field, a missing list, and findings that are not an object
			const band = { maxEmployees: 250 }
			expect(
				markRowsOutsideSize({ prospects: [] }, undefined, band).marked,
			).toBe(0)
			expect(
				markRowsOutsideSize({ brief: 'x' }, 'prospects', band).marked,
			).toBe(0)
			expect(markRowsOutsideSize(null, 'prospects', band).marked).toBe(0)
			expect(
				markRowsOutsideSize({ prospects: 'no' }, 'prospects', band).marked,
			).toBe(0)
		})

		it('should skip a list entry that is not a row', () => {
			// GIVEN a list with a stray string in it
			const findings = { prospects: ['stray', sized('Large', 900)] }
			// WHEN marked — THEN the stray entry is kept as it is and the row is marked
			const result = markRowsOutsideSize(findings, 'prospects', {
				maxEmployees: 250,
			})
			expect(prospects(result.findings)[0]).toBe('stray')
			expect(result.marked).toBe(1)
		})
	})
})
