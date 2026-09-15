import { describe, expect, it } from 'vitest'

import {
	canonicalWords,
	normaliseAttributeFilter,
} from './companies-search-params'

describe('canonicalWords [companies-search-params.ts]', () => {
	describe('when the list is one line of text', () => {
		it('should trim the words, drop the gaps and keep each word once', () => {
			// GIVEN a comma list typed by hand, with spaces, a repeat and a gap
			// WHEN canonicalised
			// THEN the same words come out in one order, once each
			expect(canonicalWords(' possible, strong,,strong ')).toEqual([
				'possible',
				'strong',
			])
		})

		it('should give back nothing for a line of commas', () => {
			// GIVEN a list that names no word
			// WHEN canonicalised
			// THEN there is nothing to narrow by
			expect(canonicalWords(' , ,')).toEqual([])
			expect(canonicalWords('')).toEqual([])
		})
	})

	describe('when the list is already a list', () => {
		it('should read it the same way as the text', () => {
			// GIVEN the words as a control ticked them, out of order
			// WHEN canonicalised
			// THEN they match what the same words typed by hand come to
			expect(canonicalWords(['strong', 'possible', 'strong'])).toEqual([
				'possible',
				'strong',
			])
			expect(canonicalWords([' a ', '', 'b'])).toEqual(['a', 'b'])
		})
	})
})

describe('normaliseAttributeFilter [companies-search-params.ts]', () => {
	describe('when all three params are present', () => {
		it('should keep an equality filter as written, beside the other filters', () => {
			// GIVEN a complete filter next to a stage filter
			const search = {
				status: ['prospect'],
				attributeKey: 'site_count',
				attributeOp: 'gte',
				attributeValue: '3',
			}
			// WHEN normalised
			// THEN nothing changes
			expect(normaliseAttributeFilter(search)).toEqual(search)
		})

		it('should trim a single value', () => {
			// GIVEN a name with spaces around it, from a hand-written link
			const search = {
				attributeKey: 'current_tools',
				attributeOp: 'contains',
				attributeValue: '  metal ',
			}
			// WHEN normalised
			// THEN the spaces are gone, so one filter has one spelling
			expect(normaliseAttributeFilter(search).attributeValue).toBe('metal')
		})

		it('should trim, deduplicate and sort a one-of list', () => {
			// GIVEN a "one of" list typed by hand, with spaces, a repeat and an empty slot
			const search = {
				attributeKey: 'fit',
				attributeOp: 'in',
				attributeValue: 'possible, strong,,strong ',
			}
			// WHEN normalised
			// THEN the list is canonical, so a saved view matches whatever the order typed
			expect(normaliseAttributeFilter(search).attributeValue).toBe(
				'possible,strong',
			)
		})

		it('should drop a one-of list that names nothing', () => {
			// GIVEN a "one of" list made of commas
			const search = {
				attributeKey: 'fit',
				attributeOp: 'in',
				attributeValue: ',,',
			}
			// WHEN normalised
			// THEN the whole filter is gone
			expect(normaliseAttributeFilter(search)).toEqual({})
		})

		it('should drop a single value that is only spaces', () => {
			// GIVEN a value box that was left holding whitespace
			const search = {
				attributeKey: 'current_tools',
				attributeOp: 'eq',
				attributeValue: '   ',
			}
			// WHEN normalised
			// THEN nothing narrows the list
			expect(normaliseAttributeFilter(search)).toEqual({})
		})
	})

	describe('when one of the three params is missing', () => {
		it('should drop the other two and keep the rest of the search', () => {
			// GIVEN a link that lost its value param
			const search = {
				query: 'acme',
				attributeKey: 'site_count',
				attributeOp: 'gte',
			}
			// WHEN normalised
			const out = normaliseAttributeFilter(search)
			// THEN only the text search survives, and the two names the link did
			// carry are held holding nothing while the third is not invented
			expect(out).toEqual({ query: 'acme' })
			expect(out.attributeKey).toBeUndefined()
			expect(out.attributeOp).toBeUndefined()
			expect('attributeValue' in out).toBe(false)
		})

		it('should hold the three names, so the raw address cannot show through', () => {
			// GIVEN a link whose comparison the app refused to read
			const search = {
				attributeKey: 'fit',
				attributeOp: undefined,
				attributeValue: 'strong',
			}
			// WHEN normalised
			const out = normaliseAttributeFilter(search)
			// THEN all three names are still there holding nothing: the router lays
			// this over the raw address, and a name left out would come back from it
			expect('attributeKey' in out).toBe(true)
			expect('attributeOp' in out).toBe(true)
			expect('attributeValue' in out).toBe(true)
			expect(out.attributeKey).toBeUndefined()
			expect(out.attributeValue).toBeUndefined()
		})
	})

	describe('when the search carries no attribute filter', () => {
		it('should return the search with no attribute names added', () => {
			// GIVEN the usual filters, from an address that never named an attribute
			const search = { status: ['client'], sort: 'name' }
			// WHEN normalised
			const out = normaliseAttributeFilter(search)
			// THEN the same fields come back and nothing else: a name held here
			// counts as a filter to anything reading how many are set
			expect(out).toEqual(search)
			expect(Object.keys(out)).toEqual(['status', 'sort'])
		})
	})
})
