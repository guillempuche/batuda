import { describe, expect, it } from 'vitest'

import { hunterStatusToVerdict } from './_client'
import { toVerdict } from './verifier'

describe('hunterStatusToVerdict', () => {
	describe('when Domain Search carries a definitive status', () => {
		it('should map valid/invalid/accept_all to pipeline verdicts', () => {
			// GIVEN Hunter per-email statuses
			// THEN they fold onto the shared verdict set
			expect(hunterStatusToVerdict('valid')).toBe('deliverable')
			expect(hunterStatusToVerdict('invalid')).toBe('undeliverable')
			expect(hunterStatusToVerdict('accept_all')).toBe('catch_all')
		})
	})

	describe('when Hunter has no usable status', () => {
		it('should return undefined so the caller falls through to verification', () => {
			// GIVEN a missing status
			// THEN there is no verdict to reuse
			expect(hunterStatusToVerdict(null)).toBeUndefined()
			expect(hunterStatusToVerdict(undefined)).toBeUndefined()
		})

		it('should treat webmail/disposable as unknown', () => {
			// GIVEN inconclusive statuses
			// THEN they degrade to unknown (still a verdict, ranked low)
			expect(hunterStatusToVerdict('webmail')).toBe('unknown')
			expect(hunterStatusToVerdict('disposable')).toBe('unknown')
		})
	})
})

describe('toVerdict', () => {
	describe('when the domain accepts all recipients', () => {
		it('should collapse any result to catch_all', () => {
			// GIVEN an accept-all domain
			// THEN even a "deliverable" result is unprovable → catch_all
			expect(toVerdict('deliverable', true)).toBe('catch_all')
		})
	})

	describe('when the domain is not accept-all', () => {
		it('should pass the Email Verifier result through', () => {
			// GIVEN concrete verifier results on a normal domain
			// THEN they map one-to-one
			expect(toVerdict('deliverable', false)).toBe('deliverable')
			expect(toVerdict('undeliverable', false)).toBe('undeliverable')
			expect(toVerdict('risky', false)).toBe('risky')
		})

		it('should map an unrecognised result to unknown', () => {
			// GIVEN a result outside the known set
			// THEN it is unknown, never silently deliverable
			expect(toVerdict('weird', false)).toBe('unknown')
		})
	})
})
