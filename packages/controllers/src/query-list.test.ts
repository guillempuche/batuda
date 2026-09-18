// Several values for one filter, as they travel on a link.
//
// The pair matters together: `CommaList` decides what counts as a value, and
// `commaListOf` decides which values exist at all. A link that names a stage
// nobody has is answered with a refusal rather than an empty list, because an
// empty list reads as "you have none of those" rather than "that is not a
// stage".

import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { CommaList, commaListOf } from './query-list'

const Stage = Schema.Literals(['open', 'closed', 'archived'])
const decode = Schema.decodeUnknownSync(commaListOf(Stage))
const encode = Schema.encodeSync(commaListOf(Stage))

describe('commaListOf [query-list.ts]', () => {
	describe('when every value is one that exists', () => {
		it('should read them in the order they were written', () => {
			// GIVEN two stages on the link
			// WHEN the value is read
			// THEN both come back, in order
			expect(decode('open,closed')).toEqual(['open', 'closed'])
		})

		it('should ignore the spaces around them', () => {
			// GIVEN a value typed with spaces and a trailing comma
			// WHEN it is read
			// THEN the spaces and the gap cost nothing
			expect(decode(' open , closed ,')).toEqual(['open', 'closed'])
		})

		it('should keep a value written twice', () => {
			// GIVEN the same stage twice
			// WHEN it is read
			// THEN what was sent is what comes back; matching any of them is the
			// same question however many times it is asked
			expect(decode('open,open')).toEqual(['open', 'open'])
		})
	})

	describe('when the value names something that does not exist', () => {
		it.each([
			['a word nobody has', 'open,bogus'],
			['the right word in the wrong case', 'OPEN'],
		])('should refuse %s', (_why, raw) => {
			// GIVEN a link naming a stage the app does not have
			// WHEN it is read
			// THEN it is refused, rather than quietly matching nothing
			expect(() => decode(raw)).toThrow()
		})
	})

	describe('when nothing was actually named', () => {
		it.each([
			['an empty value', ''],
			['commas on their own', ',,'],
		])('should read %s as nobody asking', (_why, raw) => {
			// GIVEN a filter somebody cleared
			// WHEN it is read
			// THEN it is an empty list, which filters nothing
			expect(decode(raw)).toEqual([])
		})
	})

	describe('when a link is built rather than read', () => {
		it('should write the values back the way it reads them', () => {
			// GIVEN two stages
			// WHEN they are written onto a link and read again
			const written = encode(['open', 'closed'])
			// THEN the link is the plain comma form, and it round-trips
			expect(written).toBe('open,closed')
			expect(decode(written)).toEqual(['open', 'closed'])
		})
	})

	describe('when the values are not held to a list', () => {
		it('should take any text, which is what CommaList is for', () => {
			// GIVEN a filter whose values are free text, like tags
			// WHEN a value is read through CommaList itself
			// THEN nothing is checked beyond the splitting
			expect(Schema.decodeUnknownSync(CommaList)('roof,  tiles')).toEqual([
				'roof',
				'tiles',
			])
		})
	})
})
