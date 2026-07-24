import { describe, expect, it } from 'vitest'

import { skippedCreateSlugs } from './companies'

describe('skippedCreateSlugs', () => {
	describe('when a requested slug already existed', () => {
		it('should report it as skipped', () => {
			// GIVEN two requested, only one of which landed (the other pre-existed)
			expect(skippedCreateSlugs(['acme', 'other'], new Set(['other']))).toEqual(
				['acme'],
			)
		})
	})

	describe('when the same new slug appears twice in one call', () => {
		it('should report the duplicate beyond the first as skipped', () => {
			// GIVEN a batch repeating a new slug; the unique constraint lands one row
			expect(skippedCreateSlugs(['acme', 'acme'], new Set(['acme']))).toEqual([
				'acme',
			])
		})
	})

	describe('when every requested slug landed once', () => {
		it('should report nothing skipped', () => {
			expect(skippedCreateSlugs(['a', 'b'], new Set(['a', 'b']))).toEqual([])
		})
	})
})
