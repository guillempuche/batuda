import { describe, expect, it } from 'vitest'

import {
	centsToEuros,
	EMPTY_POLICY,
	eurosToCents,
	narrowPolicy,
} from './research-policy'

describe('narrowPolicy', () => {
	it('should read the four budgets and the auto-apply threshold', () => {
		// GIVEN a policy row from the wire
		// THEN each field is picked up
		expect(
			narrowPolicy({
				budgetCents: 100,
				paidBudgetCents: 500,
				autoApprovePaidCents: 200,
				paidMonthlyCapCents: 2000,
				autoApplyMinConfidence: 80,
			}),
		).toEqual({
			budgetCents: 100,
			paidBudgetCents: 500,
			autoApprovePaidCents: 200,
			paidMonthlyCapCents: 2000,
			autoApplyMinConfidence: 80,
		})
	})

	it('should treat a null threshold as auto-apply off', () => {
		// GIVEN a policy with auto-apply disabled
		// THEN the threshold stays null (not coerced to 0)
		expect(
			narrowPolicy({ budgetCents: 10, autoApplyMinConfidence: null })
				.autoApplyMinConfidence,
		).toBeNull()
	})

	it('should fall back to the empty policy for a non-object', () => {
		// GIVEN junk instead of a policy
		// THEN every budget defaults to 0 and auto-apply is off
		expect(narrowPolicy(null)).toEqual(EMPTY_POLICY)
		expect(narrowPolicy('nope')).toEqual(EMPTY_POLICY)
	})
})

describe('centsToEuros', () => {
	it('should render whole cents as a two-decimal euro string', () => {
		// GIVEN a cents amount
		// THEN it reads as euros for a form field
		expect(centsToEuros(500)).toBe('5.00')
		expect(centsToEuros(0)).toBe('0.00')
		expect(centsToEuros(199)).toBe('1.99')
	})
})

describe('eurosToCents', () => {
	it('should parse a valid euro string to whole cents', () => {
		// GIVEN a typed euro amount
		// THEN it rounds to whole cents
		expect(eurosToCents('5')).toBe(500)
		expect(eurosToCents(' 1.99 ')).toBe(199)
		expect(eurosToCents('0')).toBe(0)
	})

	it('should reject a negative or non-numeric amount', () => {
		// GIVEN an invalid input
		// THEN it returns null so the form can refuse to submit
		expect(eurosToCents('-1')).toBeNull()
		expect(eurosToCents('abc')).toBeNull()
		expect(eurosToCents('')).toBeNull()
	})
})
