import { describe, expect, it } from 'vitest'

import { canonicalSearchKey } from './companies-atoms'

describe('canonicalSearchKey', () => {
	describe('when the search carries an owner and a sort', () => {
		it('should include both fields and their values in the key', () => {
			// GIVEN a "my leads, sorted by name" search
			const key = canonicalSearchKey({ owner: 'user-1', sort: 'name' })
			// THEN the key encodes both filter and value
			expect(key).toContain('owner')
			expect(key).toContain('user-1')
			expect(key).toContain('sort')
			expect(key).toContain('name')
		})

		it('should give different owners different keys (so the atoms differ)', () => {
			// GIVEN two searches that differ only by owner
			// THEN their cache keys differ
			expect(canonicalSearchKey({ owner: 'a' })).not.toBe(
				canonicalSearchKey({ owner: 'b' }),
			)
		})
	})

	describe('when owner or sort is an empty string', () => {
		it('should drop them, matching an unset search', () => {
			// GIVEN empty owner/sort (a cleared filter)
			// THEN the key equals the no-filter key
			expect(canonicalSearchKey({ owner: '', sort: '' })).toBe(
				canonicalSearchKey({}),
			)
		})
	})

	describe('when the same fields are given in a different order', () => {
		it('should produce a stable, order-independent key', () => {
			// GIVEN the same owner + status in two orders
			// THEN the canonical key is identical
			expect(canonicalSearchKey({ owner: 'user-1', status: 'meeting' })).toBe(
				canonicalSearchKey({ status: 'meeting', owner: 'user-1' }),
			)
		})
	})
})
