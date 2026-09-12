import { describe, expect, it } from 'vitest'

import { jobTitleOrNothing } from './contacts'

describe('jobTitleOrNothing', () => {
	describe('when no title was given', () => {
		it('should read the same however the caller said so', () => {
			// GIVEN the three ways a caller says there is no job title — a form that
			// cleared the box, a caller that left the field out, and one taking a
			// wrong title back off
			// THEN all three are one answer, so a reader has one absence to know
			// about rather than three
			expect(jobTitleOrNothing('')).toBeNull()
			expect(jobTitleOrNothing(undefined)).toBeNull()
			expect(jobTitleOrNothing(null)).toBeNull()
		})

		it('should read a title of nothing but spaces as no title', () => {
			// GIVEN a box that looks filled in and says nothing
			for (const written of [' ', '   ', '\t', '\n  ']) {
				// THEN it is no title, not a title made of whitespace
				expect(jobTitleOrNothing(written), JSON.stringify(written)).toBeNull()
			}
		})
	})

	describe('when a title was given', () => {
		it('should keep it as the page wrote it', () => {
			// GIVEN a title copied off a company's own page
			// THEN it is kept as written — accents, punctuation, case and all. It gets
			// quoted back confidently in an opening line, so a tidied one is a mistake
			// somebody makes out loud
			expect(jobTitleOrNothing('CEO - Enginyer Industrial')).toBe(
				'CEO - Enginyer Industrial',
			)
			expect(jobTitleOrNothing("Cap d'obres")).toBe("Cap d'obres")
		})

		it('should take the surrounding spaces off', () => {
			// GIVEN a title with the spacing a copy-paste leaves behind
			// THEN the title survives and the spacing does not
			expect(jobTitleOrNothing('  Directora Financera  ')).toBe(
				'Directora Financera',
			)
		})

		it('should keep a title that is only a number or a symbol', () => {
			// GIVEN titles that are not words
			// THEN both are kept. Whether they are useful is the caller's business;
			// this only decides whether something was said at all
			expect(jobTitleOrNothing('2')).toBe('2')
			expect(jobTitleOrNothing('-')).toBe('-')
		})
	})
})
