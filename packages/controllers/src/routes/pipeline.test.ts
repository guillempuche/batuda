import { Exit, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { PriorityFromString } from './pipeline'

const decode = Schema.decodeUnknownExit(PriorityFromString)

describe('PriorityFromString', () => {
	describe('when the query string names a priority on the scale', () => {
		it('should read it as that number', () => {
			// GIVEN each priority the domain defines, as a query string carries it
			// WHEN each is decoded
			// THEN each comes back as its number
			expect(decode('1')).toEqual(Exit.succeed(1))
			expect(decode('3')).toEqual(Exit.succeed(3))
		})
	})

	describe('when the query string is not a priority', () => {
		it('should refuse it rather than filter on nonsense', () => {
			// GIVEN text, a fraction, numbers off the scale, and nothing at all —
			// read as plain numbers they become NaN, 2.5, 0 or 4 and quietly
			// match no company
			const junk = ['abc', '2.5', '0', '4', 'Infinity', '']

			// WHEN each is decoded
			// THEN every one is refused, so the caller is told the filter is wrong
			for (const value of junk) expect(Exit.isFailure(decode(value))).toBe(true)
		})
	})
})
