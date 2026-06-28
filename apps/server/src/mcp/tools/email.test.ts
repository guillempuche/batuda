import { describe, expect, it } from 'vitest'

import { isRiskyEmailVerdict } from './email'

describe('isRiskyEmailVerdict', () => {
	describe('when the email channel is confirmed deliverable', () => {
		it('should not gate the send', () => {
			// GIVEN a deliverable verdict
			// WHEN the agent send guard checks it
			// THEN no confirmation is needed
			expect(isRiskyEmailVerdict('deliverable')).toBe(false)
		})
	})

	describe('when the verdict is anything other than deliverable', () => {
		it('should gate risky / catch_all / undeliverable / unknown', () => {
			// GIVEN the non-deliverable verdicts the pipeline produces
			// THEN each asks the agent to confirm first
			expect(isRiskyEmailVerdict('risky')).toBe(true)
			expect(isRiskyEmailVerdict('catch_all')).toBe(true)
			expect(isRiskyEmailVerdict('undeliverable')).toBe(true)
			expect(isRiskyEmailVerdict('unknown')).toBe(true)
		})

		it('should gate an unrecognised value conservatively', () => {
			// GIVEN a verdict outside the known set (legacy / bad data)
			// THEN it is treated as risky rather than silently trusted
			expect(isRiskyEmailVerdict('weird')).toBe(true)
		})
	})

	describe('when there is no verdict at all', () => {
		it('should not gate a contact with no email-channel verification', () => {
			// GIVEN null — the contact was never verified
			// THEN the guard stays out of the way (no evidence the address is bad)
			expect(isRiskyEmailVerdict(null)).toBe(false)
		})
	})
})
