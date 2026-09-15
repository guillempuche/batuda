import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { validateSearchWith } from './search-schema'

const decode = validateSearchWith({
	query: Schema.NonEmptyString,
	attributeValue: Schema.NonEmptyString,
	priority: Schema.Union([Schema.Number, Schema.NumberFromString]),
	deleted: Schema.Literals(['only']),
})

describe('validateSearchWith [search-schema.ts]', () => {
	describe('when the router read a bare value as JSON', () => {
		it('should read a number back as its text for a text field', () => {
			// GIVEN a hand-typed `?attributeValue=2&query=2024`, which the router
			// parses as the numbers 2 and 2024
			// WHEN validated
			const out = decode({ attributeValue: 2, query: 2024 })
			// THEN the digits are what the filters get
			expect(out.attributeValue).toBe('2')
			expect(out.query).toBe('2024')
		})

		it('should read a yes/no back as its word', () => {
			// GIVEN `?attributeValue=false`, which the router parses as the boolean
			// WHEN validated
			// THEN the word the server reads a yes/no by comes through
			expect(decode({ attributeValue: false }).attributeValue).toBe('false')
			expect(decode({ attributeValue: true }).attributeValue).toBe('true')
		})
	})

	describe('when a param cannot be read', () => {
		it('should keep the key and answer undefined, so the raw address is covered', () => {
			// GIVEN a value no text field can take
			const out = decode({ attributeValue: { nested: 1 } })
			// WHEN validated
			// THEN the key is there holding nothing, which is what shadows the raw
			// param the router lays underneath this answer
			expect('attributeValue' in out).toBe(true)
			expect(out.attributeValue).toBeUndefined()
		})

		it('should cover a word outside a closed set', () => {
			// GIVEN a filter that was dropped from the app
			const out = decode({ deleted: 'archived' })
			// WHEN validated
			// THEN it is covered rather than passed on to the server
			expect('deleted' in out).toBe(true)
			expect(out.deleted).toBeUndefined()
		})

		it('should cover a number field given something no number can be read from', () => {
			// GIVEN a param the router made an object of
			const out = decode({ priority: { from: 3 } })
			// WHEN validated
			// THEN the key is covered rather than passed on as a filter
			expect('priority' in out).toBe(true)
			expect(out.priority).toBeUndefined()
		})
	})

	describe('when the address does not carry a param', () => {
		it('should leave the key absent', () => {
			// GIVEN an address with nothing in it
			const out = decode({})
			// WHEN validated
			// THEN no key is invented, so the shape stays the one the app declares
			expect('query' in out).toBe(false)
			expect(Object.keys(out)).toEqual([])
		})
	})

	describe('when one param is bad and its neighbours are not', () => {
		it('should keep the neighbours', () => {
			// GIVEN a stale filter beside a text search and a priority
			const out = decode({
				deleted: 'archived',
				query: 'acme',
				priority: '3',
			})
			// WHEN validated
			// THEN the two that read fine are there, and the number is a number
			expect(out.query).toBe('acme')
			expect(out.priority).toBe(3)
			expect(out.deleted).toBeUndefined()
		})
	})

	describe('when a number field reads a number', () => {
		it('should keep it as a number, from the address or from a link', () => {
			// GIVEN a priority as the router parsed it, and as a link wrote it
			// WHEN validated
			// THEN both are the same number
			expect(decode({ priority: 3 }).priority).toBe(3)
			expect(decode({ priority: '3' }).priority).toBe(3)
		})
	})

	describe('when a text field gets an empty word', () => {
		it('should cover it rather than filter by nothing', () => {
			// GIVEN `?query=` left behind by a cleared box
			const out = decode({ query: '' })
			// WHEN validated
			// THEN the key holds nothing, so no empty search reaches the list
			expect('query' in out).toBe(true)
			expect(out.query).toBeUndefined()
		})
	})
})
