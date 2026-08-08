import { describe, expect, it } from 'vitest'

import {
	HandSetVerificationVerdict,
	isVerificationVerdict,
	VERIFICATION_VERDICTS,
} from './channel-verification'

describe('channel verification vocabulary', () => {
	describe('when checking a stored value against the vocabulary', () => {
		it('should accept every verdict the list names', () => {
			// GIVEN the five verdicts a deliverability check can produce
			// WHEN each is checked
			// THEN all of them are recognised
			for (const verdict of VERIFICATION_VERDICTS) {
				expect(isVerificationVerdict(verdict)).toBe(true)
			}
		})

		it('should refuse a word that only looks like a verdict', () => {
			// GIVEN words that reached the column while it was free text, plus the
			// near-misses a careless import produces
			// WHEN each is checked
			// THEN none is recognised, so it can be repaired rather than stored
			expect(isVerificationVerdict('inferred')).toBe(false)
			expect(isVerificationVerdict('valid')).toBe(false)
			expect(isVerificationVerdict('Deliverable')).toBe(false)
			expect(isVerificationVerdict(' risky')).toBe(false)
			expect(isVerificationVerdict('')).toBe(false)
		})
	})

	describe('when deciding what a person may set by hand', () => {
		it('should offer only verdicts that take trust away', () => {
			// GIVEN the hand-set subset
			// WHEN reading which words it allows
			// THEN it is exactly the three that withdraw trust
			expect(HandSetVerificationVerdict.literals).toEqual([
				'risky',
				'undeliverable',
				'unknown',
			])
		})

		it('should never let a caller claim an address is good', () => {
			// GIVEN `deliverable` is the one word the send path lets through, and
			// `catch_all` is a finding only a mailbox probe can make
			// WHEN looking for either in the hand-set subset
			// THEN neither is there, so no caller can grant trust it did not earn
			const handSet: ReadonlyArray<string> = HandSetVerificationVerdict.literals
			expect(handSet).not.toContain('deliverable')
			expect(handSet).not.toContain('catch_all')
		})

		it('should stay a subset of the full vocabulary', () => {
			// GIVEN the subset is picked out of the full list rather than retyped
			// WHEN comparing the two
			// THEN every hand-set word is still a real verdict
			for (const verdict of HandSetVerificationVerdict.literals) {
				expect(isVerificationVerdict(verdict)).toBe(true)
			}
		})
	})
})
