import { describe, expect, it } from 'vitest'

import { isLikelyEmail, normalizeEmail } from './forms'

describe('isLikelyEmail [forms.ts]', () => {
	describe('when the value is a whole address', () => {
		it('should accept it', () => {
			// GIVEN an ordinary address
			// WHEN checked
			// THEN it passes
			expect(isLikelyEmail('colleague@taller.cat')).toBe(true)
		})
	})

	describe('when the value is not an address', () => {
		it.each([
			['no @ at all', 'not-an-email'],
			['nothing before the @', '@taller.cat'],
			['nothing after the @', 'colleague@'],
			['two @', 'a@b@c'],
			['a space inside', 'col league@taller.cat'],
			['empty', ''],
		])('should refuse %s', (_label, value) => {
			// GIVEN a malformed value
			// WHEN checked
			// THEN it fails, so the form can say so in its own words
			expect(isLikelyEmail(value)).toBe(false)
		})
	})
})

describe('normalizeEmail [forms.ts]', () => {
	describe('when pasted with spaces and capitals', () => {
		it('should trim and lowercase it', () => {
			// GIVEN a pasted address
			// WHEN normalized
			// THEN it reads the way it is stored
			expect(normalizeEmail('  Colleague@Taller.CAT ')).toBe(
				'colleague@taller.cat',
			)
		})
	})
})
