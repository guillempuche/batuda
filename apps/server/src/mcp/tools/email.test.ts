import { describe, expect, it } from 'vitest'

import { isRiskyEmailVerdict } from './email'

describe('isRiskyEmailVerdict', () => {
	describe('when the verdict says something against the address', () => {
		it('should stop a send to ask first', () => {
			// GIVEN the two verdicts that carry evidence — the mailbox is not there,
			// or something about it is off
			// WHEN the agent send guard checks them
			// THEN each one stops the send
			expect(isRiskyEmailVerdict('undeliverable')).toBe(true)
			expect(isRiskyEmailVerdict('risky')).toBe(true)
		})
	})

	describe('when a check ran but settled nothing', () => {
		it('should let a catch-all domain through', () => {
			// GIVEN a domain that answers to every name, so the check learned nothing
			// about this particular mailbox — an ordinary arrangement, not a fault
			// THEN there is nothing to stop the send for
			expect(isRiskyEmailVerdict('catch_all')).toBe(false)
		})

		it('should let an inconclusive check through', () => {
			// GIVEN a check that ran and settled nothing
			// THEN it says exactly what no verdict says, so it is treated the same
			expect(isRiskyEmailVerdict('unknown')).toBe(false)
			expect(isRiskyEmailVerdict('unknown')).toBe(isRiskyEmailVerdict(null))
		})
	})

	describe('when the address is confirmed deliverable', () => {
		it('should not stop the send', () => {
			// GIVEN a mailbox that answered
			expect(isRiskyEmailVerdict('deliverable')).toBe(false)
		})
	})

	describe('when there is no verdict at all', () => {
		it('should not stop a send to an address nobody has checked', () => {
			// GIVEN null — nobody ever checked, which is most addresses on file
			// THEN the guard stays out of the way; there is no evidence against it
			expect(isRiskyEmailVerdict(null)).toBe(false)
		})
	})

	describe('when the word is not one this knows', () => {
		it('should stop the send rather than trust it', () => {
			// GIVEN a value the column accepted but nothing here recognises — the
			// column takes free text, so nobody vetted this one
			// THEN it stops the send, because letting it through is the costly way
			// to be wrong
			expect(isRiskyEmailVerdict('weird')).toBe(true)
			expect(isRiskyEmailVerdict('inferred')).toBe(true)
		})

		it('should not be fooled by a known word in another case', () => {
			// GIVEN a verdict stored with a capital
			// THEN it is not read as the word it resembles
			expect(isRiskyEmailVerdict('Deliverable')).toBe(true)
			expect(isRiskyEmailVerdict('CATCH_ALL')).toBe(true)
		})

		it('should stop the send on an empty word', () => {
			// GIVEN an empty string, which is not the same as no verdict
			expect(isRiskyEmailVerdict('')).toBe(true)
		})
	})
})
