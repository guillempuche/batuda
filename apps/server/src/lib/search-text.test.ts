import { describe, expect, it } from 'vitest'

import { textAnywhere, textAtTheStart } from './search-text'

describe('textAnywhere', () => {
	describe('when somebody types ordinary words', () => {
		it('should look for those words anywhere in the column', () => {
			// GIVEN a plain search
			// WHEN turned into a pattern
			// THEN the words sit between the two wildcards and nothing else changes
			expect(textAnywhere('acme')).toBe('%acme%')
		})

		it('should leave letters no web address could carry alone', () => {
			// GIVEN a name written with accents, and one in another alphabet
			// WHEN turned into a pattern
			// THEN both go through untouched: only the two characters SQL reads as
			// instructions are worth escaping, and a letter is never one of them
			expect(textAnywhere('Fabricació')).toBe('%Fabricació%')
			expect(textAnywhere('北京物流')).toBe('%北京物流%')
		})
	})

	describe('when somebody types a character SQL reads as an instruction', () => {
		it('should look for the per-cent sign rather than for anything at all', () => {
			// GIVEN a search for a discount
			// WHEN turned into a pattern
			// THEN the sign is escaped. Left alone it means "anything here", so this
			// search would answer with every row in the table
			expect(textAnywhere('50%')).toBe('%50\\%%')
		})

		it('should look for the underscore rather than for any one character', () => {
			// GIVEN a search for a name written with an underscore
			// WHEN turned into a pattern
			// THEN escaped, since an underscore left alone reaches "axb" too
			expect(textAnywhere('a_b')).toBe('%a\\_b%')
		})

		it('should escape a backslash before the character it would carry', () => {
			// GIVEN somebody typing a backslash and a per-cent sign
			// WHEN turned into a pattern
			// THEN the backslash is escaped first, so it cannot turn the sign after
			// it back into an instruction
			expect(textAnywhere('a\\%b')).toBe('%a\\\\\\%b%')
		})

		it('should still answer for a search that is nothing but instructions', () => {
			// GIVEN a search of only the two characters SQL treats specially
			// WHEN turned into a pattern
			// THEN both escaped, so it asks for those characters rather than for
			// every row
			expect(textAnywhere('%_')).toBe('%\\%\\_%')
		})
	})

	describe('when there is nothing to search for', () => {
		it('should ask for every row, which is what an empty search means', () => {
			// GIVEN an empty search
			// WHEN turned into a pattern
			// THEN the two wildcards and nothing between them. A caller that does not
			// want this decides not to search at all rather than passing empty text
			expect(textAnywhere('')).toBe('%%')
		})
	})
})

describe('textAtTheStart', () => {
	describe('when a name is being completed as somebody types', () => {
		it('should look only at the front of the column', () => {
			// GIVEN the letters typed so far
			// WHEN turned into a pattern
			// THEN one wildcard, at the end, so a name is completed rather than found
			// anywhere inside another one
			expect(textAtTheStart('acm')).toBe('acm%')
		})

		it('should escape a character SQL reads as an instruction', () => {
			// GIVEN a slug being completed that carries an underscore
			// WHEN turned into a pattern
			// THEN escaped, exactly as it is when looking anywhere
			expect(textAtTheStart('a_b')).toBe('a\\_b%')
		})
	})
})
