import { describe, expect, it } from 'vitest'

import { guessEmails } from './email-guess'

describe('guessEmails', () => {
	describe('when given a full first and last name', () => {
		it('should lead with first.last and include the common variants', () => {
			// GIVEN a normal two-part name at a domain
			// WHEN candidates are generated
			// THEN the most common B2B pattern (first.last) comes first
			const result = guessEmails({
				firstName: 'Jane',
				lastName: 'Smith',
				domain: 'acme.com',
			})
			expect(result[0]).toBe('jane.smith@acme.com')
			// AND the standard alternates are present
			expect(result).toContain('jsmith@acme.com')
			expect(result).toContain('janesmith@acme.com')
			expect(result).toContain('jane@acme.com')
		})

		it('should never repeat a candidate', () => {
			// GIVEN any name
			// THEN every generated address is unique
			const result = guessEmails({
				firstName: 'Ann',
				lastName: 'Lee',
				domain: 'x.io',
			})
			expect(new Set(result).size).toBe(result.length)
		})
	})

	describe('when a vendor pattern is supplied', () => {
		it('should try the supplied pattern before the defaults', () => {
			// GIVEN a detected pattern that differs from the default head
			// WHEN candidates are generated
			// THEN the patterned address is produced first
			const result = guessEmails({
				firstName: 'Jane',
				lastName: 'Smith',
				domain: 'acme.com',
				pattern: '{f}.{last}',
			})
			expect(result[0]).toBe('j.smith@acme.com')
		})

		it('should skip a supplied pattern whose tokens are missing', () => {
			// GIVEN a vendor pattern that needs {last} but only a first name is known
			// WHEN candidates are generated
			// THEN that pattern is dropped (no dangling 'jane.@domain'), and the
			// fallback single-token address leads instead
			// [email-guess.ts — applyPattern returns null on a missing token]
			const result = guessEmails({
				firstName: 'Jane',
				lastName: '',
				domain: 'acme.com',
				pattern: '{first}.{last}',
			})
			expect(result).toEqual(['jane@acme.com'])
		})
	})

	describe('when the name carries accents or punctuation', () => {
		it('should fold diacritics and drop non-letters from the local part', () => {
			// GIVEN an accented first name and an apostrophe in the last name
			// THEN the local part is ascii-folded and symbol-free
			const result = guessEmails({
				firstName: 'José',
				lastName: "O'Néil",
				domain: 'corp.es',
			})
			expect(result[0]).toBe('jose.oneil@corp.es')
		})
	})

	describe('when only one name token is known', () => {
		it('should emit only the single-token address, no dangling separators', () => {
			// GIVEN a first name but no last name
			// THEN patterns needing {last}/{l} are skipped, leaving first@domain
			const result = guessEmails({
				firstName: 'Madonna',
				lastName: '',
				domain: 'star.fm',
			})
			expect(result).toEqual(['madonna@star.fm'])
		})
	})

	describe('when the input is degenerate', () => {
		it('should return nothing without a domain', () => {
			// GIVEN an empty domain
			// THEN there is nothing to guess
			expect(
				guessEmails({ firstName: 'Jane', lastName: 'Smith', domain: '' }),
			).toEqual([])
		})

		it('should return nothing without any name', () => {
			// GIVEN neither first nor last name
			// THEN there is nothing to guess
			expect(
				guessEmails({ firstName: '', lastName: '', domain: 'acme.com' }),
			).toEqual([])
		})

		it('should return nothing when a non-latin name normalizes to empty', () => {
			// GIVEN a name written in a script with no latin letters (CJK here)
			// WHEN candidates are generated
			// THEN normalization strips every token to empty and nothing is
			// guessable from a pattern — the universal pipeline yields no address
			// for this name and must lean on a vendor-supplied email instead
			// [email-guess.ts — normalize drops [^a-z0-9]; guard !first && !last]
			expect(
				guessEmails({ firstName: '李', lastName: '王', domain: 'acme.cn' }),
			).toEqual([])
		})

		it('should normalize away a leading @ on the domain', () => {
			// GIVEN a domain written with a leading @
			// THEN it is stripped before building the address
			const result = guessEmails({
				firstName: 'Jane',
				lastName: 'Smith',
				domain: '@acme.com',
			})
			expect(result[0]).toBe('jane.smith@acme.com')
		})

		it('should lowercase and trim a domain with stray case and whitespace', () => {
			// GIVEN a domain with surrounding whitespace and mixed case
			// THEN it is folded to a clean lowercase host before the @
			// [email-guess.ts — domain.trim().toLowerCase()]
			const result = guessEmails({
				firstName: 'Jane',
				lastName: 'Smith',
				domain: '  ACME.COM  ',
			})
			expect(result[0]).toBe('jane.smith@acme.com')
		})
	})
})
