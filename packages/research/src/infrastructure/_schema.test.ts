import { Option, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	firstText,
	NullableOptional,
	NullableOptionalTextOrList,
} from './_schema'

// A vendor field read through each helper, so the assertions run against the
// same decoding path an adapter uses rather than the helper in the abstract.
const decodeNullable = Schema.decodeUnknownOption(
	Schema.Struct({ field: NullableOptional(Schema.String) }),
)
const decodeTextOrList = Schema.decodeUnknownOption(
	Schema.Struct({ field: NullableOptionalTextOrList }),
)

describe('NullableOptional', () => {
	describe('when the vendor sends the field', () => {
		it('should read the value', () => {
			// GIVEN a response carrying the field
			// WHEN decoded
			const decoded = decodeNullable({ field: 'es-ES' })

			// THEN the value comes through untouched
			expect(Option.getOrUndefined(decoded)?.field).toBe('es-ES')
		})
	})

	describe('when the vendor leaves the field out', () => {
		it('should read a missing key as nothing', () => {
			// GIVEN a response with no such key at all
			// WHEN decoded
			const decoded = decodeNullable({})

			// THEN it carries nothing, and the answer still stands
			expect(Option.isSome(decoded)).toBe(true)
			expect(Option.getOrUndefined(decoded)?.field).toBeUndefined()
		})

		it('should read an explicit null as nothing', () => {
			// GIVEN a response sending null where a value is documented — the shape
			// a plain optional rejects, losing an answer the vendor already billed
			// WHEN decoded
			const decoded = decodeNullable({ field: null })

			// THEN it reads the same way as a missing key
			expect(Option.isSome(decoded)).toBe(true)
			expect(Option.getOrUndefined(decoded)?.field).toBeNull()
		})
	})

	describe('when the vendor sends something else entirely', () => {
		it('should still refuse a value of the wrong type', () => {
			// GIVEN a field holding a number where text is expected
			// WHEN decoded
			// THEN widening has not made the description accept anything at all
			expect(Option.isNone(decodeNullable({ field: 42 }))).toBe(true)
		})
	})
})

describe('NullableOptionalTextOrList', () => {
	describe('when the field carries one value', () => {
		it('should read a single value', () => {
			// GIVEN a page declaring its language once
			// WHEN decoded
			const decoded = decodeTextOrList({ field: 'es-ES' })

			// THEN the value comes through
			expect(Option.getOrUndefined(decoded)?.field).toBe('es-ES')
		})
	})

	describe('when the field carries a list', () => {
		it('should read a list of values', () => {
			// GIVEN a page declaring its language in two places at once, which the
			// vendor reports as a list
			// WHEN decoded
			const decoded = decodeTextOrList({ field: ['es-ES', 'ES'] })

			// THEN the whole list survives for the caller to pick from
			expect(Option.getOrUndefined(decoded)?.field).toEqual(['es-ES', 'ES'])
		})

		it('should read an empty list', () => {
			// GIVEN a list with nothing in it
			// WHEN decoded
			// THEN that is still a readable answer, not a broken one
			expect(Option.isSome(decodeTextOrList({ field: [] }))).toBe(true)
		})
	})

	describe('when the field is absent or null', () => {
		it('should read either as nothing', () => {
			// GIVEN the two ways a vendor omits a field
			// WHEN decoded
			// THEN both are accepted
			expect(Option.isSome(decodeTextOrList({}))).toBe(true)
			expect(Option.isSome(decodeTextOrList({ field: null }))).toBe(true)
		})
	})

	describe('when the list holds something other than text', () => {
		it('should refuse it', () => {
			// GIVEN a list of numbers where text is expected
			// WHEN decoded
			// THEN the description still holds
			expect(Option.isNone(decodeTextOrList({ field: [1, 2] }))).toBe(true)
		})
	})
})

describe('firstText', () => {
	describe('when the field carries one value', () => {
		it('should return that value', () => {
			// GIVEN a single value
			// THEN it is what the field carries
			expect(firstText('es-ES')).toBe('es-ES')
		})

		it('should return an empty string as it stands', () => {
			// GIVEN a vendor sending an empty value rather than omitting the field
			// THEN it passes through unchanged, exactly as a plain optional field
			// would have — emptiness is the caller's to judge, not this helper's
			expect(firstText('')).toBe('')
		})
	})

	describe('when the field carries a list', () => {
		it('should return the first entry', () => {
			// GIVEN a page that declared its language twice
			// THEN the first entry is the one the field carries
			expect(firstText(['es-ES', 'ES'])).toBe('es-ES')
		})

		it('should return nothing for an empty list', () => {
			// GIVEN a list with nothing in it
			// THEN there is no first entry, so the field carries nothing
			expect(firstText([])).toBeUndefined()
		})
	})

	describe('when the field carries nothing', () => {
		it('should return nothing for null and for undefined alike', () => {
			// GIVEN the two ways a vendor omits a field
			// THEN both read as nothing, so a caller never has to tell them apart
			expect(firstText(null)).toBeUndefined()
			expect(firstText(undefined)).toBeUndefined()
		})
	})
})
