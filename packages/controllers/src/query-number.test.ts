import { Exit, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { FiniteFromQuery } from './query-number'

const decode = Schema.decodeUnknownExit(FiniteFromQuery)

describe('FiniteFromQuery', () => {
	describe('when the query string holds a number', () => {
		it('should read it, negative and fractional included', () => {
			// GIVEN a latitude, a negative longitude and a confidence as text
			// WHEN each is decoded
			// THEN each comes back as its number
			expect(decode('41.38')).toEqual(Exit.succeed(41.38))
			expect(decode('-2.17')).toEqual(Exit.succeed(-2.17))
			expect(decode('80')).toEqual(Exit.succeed(80))
		})
	})

	describe('when the query string holds no number', () => {
		it('should refuse it rather than read it as 0 or NaN', () => {
			// GIVEN an emptied param, blanks, text and the non-finite words — plain
			// number parsing reads the first two as 0 and the rest as NaN or
			// Infinity, each a filter nobody asked for
			const junk = ['', '  ', ' 4', 'abc', 'NaN', 'Infinity']

			// WHEN each is decoded
			// THEN every one is refused
			for (const value of junk) expect(Exit.isFailure(decode(value))).toBe(true)
		})
	})
})
