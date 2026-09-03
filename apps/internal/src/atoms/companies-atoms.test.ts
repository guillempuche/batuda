import { describe, expect, it } from 'vitest'

import { canonicalSearchKey } from './companies-atoms'

describe('canonicalSearchKey', () => {
	describe('when the search carries an owner and a sort', () => {
		it('should include both fields and their values in the key', () => {
			// GIVEN a "my leads, sorted by name" search
			const key = canonicalSearchKey({ owner: ['user-1'], sort: 'name' })
			// THEN the key encodes both filter and value
			expect(key).toContain('owner')
			expect(key).toContain('user-1')
			expect(key).toContain('sort')
			expect(key).toContain('name')
		})

		it('should give different owners different keys (so the atoms differ)', () => {
			// GIVEN two searches that differ only by owner
			// THEN their cache keys differ
			expect(canonicalSearchKey({ owner: ['a'] })).not.toBe(
				canonicalSearchKey({ owner: ['b'] }),
			)
		})
	})

	describe('when a filter is empty', () => {
		it('should drop a blank string, matching an unset search', () => {
			// GIVEN a cleared free-text filter
			// THEN the key equals the no-filter key
			expect(canonicalSearchKey({ query: '' })).toBe(canonicalSearchKey({}))
		})

		it('should drop an empty list, matching an unset search', () => {
			// GIVEN a caller that read no stages from its form and sent the empty
			// list — which the server also reads as nobody asking
			// THEN the key must agree, or the same list answers to two entries and
			// is fetched twice
			expect(canonicalSearchKey({ status: [], tags: [] })).toBe(
				canonicalSearchKey({}),
			)
		})

		it('should drop a blank among real values', () => {
			// GIVEN a trailing comma in the link, which decodes to a blank
			// THEN it changes nothing about which list this is
			expect(canonicalSearchKey({ tags: ['pilot', ''] })).toBe(
				canonicalSearchKey({ tags: ['pilot'] }),
			)
		})
	})

	describe('when the same fields are given in a different order', () => {
		it('should produce a stable, order-independent key', () => {
			// GIVEN the same owner + status in two orders
			// THEN the canonical key is identical
			expect(
				canonicalSearchKey({ owner: ['user-1'], status: ['meeting'] }),
			).toBe(canonicalSearchKey({ status: ['meeting'], owner: ['user-1'] }))
		})
	})

	describe('when one filter holds the same values in a different order', () => {
		it('should produce one key, not two', () => {
			// GIVEN two links naming the same two tags the other way round
			// WHEN each is turned into a cache key
			// THEN they are the same list. Left unsorted they would be two atoms
			// fetching identical rows, and a saved view would stop reading as active
			// the moment its tags came back reordered
			expect(canonicalSearchKey({ tags: ['b', 'a'] })).toBe(
				canonicalSearchKey({ tags: ['a', 'b'] }),
			)
		})

		it('should still tell different sets apart', () => {
			// GIVEN one link naming a second tag
			// THEN it is a different, narrower list
			expect(canonicalSearchKey({ tags: ['a', 'b'] })).not.toBe(
				canonicalSearchKey({ tags: ['a'] }),
			)
		})
	})

	describe('when a filter nobody listed by hand is set', () => {
		it('should still reach the key', () => {
			// GIVEN the fit verdict, which no hand-written list of fields names
			// THEN it separates the two lists. The key reads whatever the search
			// holds rather than a list of names kept in step by hand, which is what
			// stops a new filter from sharing another one's entry
			expect(canonicalSearchKey({ fitVerdict: ['strong_fit'] })).not.toBe(
				canonicalSearchKey({}),
			)
		})
	})
})
