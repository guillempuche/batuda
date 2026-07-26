import { Option, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { ResearchPolicyRow } from './research-service'

// What a saved research policy has to look like before it can be read back.
//
// The figures a person sets for themselves live on their own row; the ceiling
// for a whole month belongs to the company and lives on the company's row. So
// whoever reads a person's policy has to fetch that one figure separately and
// add it in, and these cases pin that requirement down: a row handed over
// without it is refused rather than accepted half-formed.

const decode = Schema.decodeUnknownOption(ResearchPolicyRow)

// What the person's own table hands back, with no company ceiling in it.
const rowFromPersonTable = {
	budgetCents: 725,
	paidBudgetCents: 900,
	autoApprovePaidCents: 300,
	autoApplyMinConfidence: 80,
	updatedAt: new Date('2026-07-25T10:00:00Z'),
}

describe('the shape a saved research policy is read back in', () => {
	describe('when the row comes straight from the person’s own table', () => {
		it('should refuse it, because the company ceiling is missing', () => {
			// GIVEN a row exactly as the person's table returns it
			// WHEN it is read back without the company's ceiling added
			// THEN it is refused, so a caller cannot skip fetching that figure
			expect(Option.isNone(decode(rowFromPersonTable))).toBe(true)
		})
	})

	describe('when the company ceiling is added alongside', () => {
		it('should accept it and keep every figure', () => {
			// GIVEN the same row with the company's monthly ceiling supplied
			// WHEN it is read back
			// THEN it is accepted, carrying the person's figures and the company's
			const decoded = decode({
				...rowFromPersonTable,
				paidMonthlyCapCents: 4200,
			})

			expect(Option.isSome(decoded)).toBe(true)
			if (Option.isNone(decoded)) return
			expect(decoded.value.budgetCents).toBe(725)
			expect(decoded.value.paidBudgetCents).toBe(900)
			expect(decoded.value.autoApprovePaidCents).toBe(300)
			expect(decoded.value.paidMonthlyCapCents).toBe(4200)
			expect(decoded.value.autoApplyMinConfidence).toBe(80)
		})
	})

	describe('when auto-apply is switched off', () => {
		it('should accept a policy with no confidence set', () => {
			// GIVEN a policy whose auto-apply confidence is empty, which is how
			//   auto-apply being switched off is recorded
			// WHEN it is read back
			// THEN it is accepted, because empty is a real setting here rather than
			//   a missing one
			const decoded = decode({
				...rowFromPersonTable,
				autoApplyMinConfidence: null,
				paidMonthlyCapCents: 3000,
			})

			expect(Option.isSome(decoded)).toBe(true)
			if (Option.isNone(decoded)) return
			expect(decoded.value.autoApplyMinConfidence).toBeNull()
		})
	})

	describe('when the last-changed time is empty', () => {
		it('should still accept the row', () => {
			// GIVEN a row whose last-changed time is empty
			// WHEN it is read back
			// THEN it is accepted, because a policy is still a policy without a
			//   record of when it last changed
			const decoded = decode({
				...rowFromPersonTable,
				updatedAt: null,
				paidMonthlyCapCents: 3000,
			})

			expect(Option.isSome(decoded)).toBe(true)
		})
	})

	describe('when a figure arrives as text', () => {
		it('should refuse it rather than guess at the number', () => {
			// GIVEN a budget that arrived as text instead of a number
			// WHEN it is read back
			// THEN it is refused, so money is never read from a loose value
			expect(
				Option.isNone(
					decode({
						...rowFromPersonTable,
						budgetCents: '725',
						paidMonthlyCapCents: 3000,
					}),
				),
			).toBe(true)
		})
	})
})
