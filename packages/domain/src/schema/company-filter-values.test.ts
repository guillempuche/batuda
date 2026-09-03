import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { CompanyCountry, CompanySort, CompanyTag } from './companies'

// The shapes a company filter compares against, and the write rules that keep
// what is stored comparable with what is asked for.

const decode = <A, I>(schema: Schema.Codec<A, I>, input: I) =>
	Schema.decodeUnknownExit(schema)(input)

describe('a company country', () => {
	describe('when a caller writes one in lower case', () => {
		it('should be raised to capitals before it is stored', () => {
			// GIVEN a country typed in as free text, which is what a caller sends
			// WHEN it is decoded on the way in
			const result = decode(CompanyCountry, 'es')

			// THEN it is stored the way the filter and the counts compare it. Left as
			// typed, the company would be missed by anyone asking for ES and would be
			// offered as a second Spain with a count of its own
			expect(result._tag).toBe('Success')
			if (result._tag === 'Success') expect(result.value).toBe('ES')
		})

		it('should leave one already in capitals alone', () => {
			// GIVEN the form nearly every caller already sends
			const result = decode(CompanyCountry, 'ES')

			// THEN nothing changes, so the rule is safe to apply everywhere
			expect(result._tag).toBe('Success')
			if (result._tag === 'Success') expect(result.value).toBe('ES')
		})
	})

	describe('when it is not two letters', () => {
		it('should be refused rather than stored', () => {
			// GIVEN values that are the wrong shape for a country code
			// THEN each is turned away where it is typed
			expect(decode(CompanyCountry, 'ESP')._tag).toBe('Failure')
			expect(decode(CompanyCountry, 'E')._tag).toBe('Failure')
			expect(decode(CompanyCountry, '')._tag).toBe('Failure')
			expect(decode(CompanyCountry, '12')._tag).toBe('Failure')
		})
	})
})

describe('a company tag', () => {
	describe('when it holds a comma', () => {
		it('should be refused, because several tags travel as one comma list', () => {
			// GIVEN a label somebody might reasonably type
			// WHEN it is written
			const result = decode(CompanyTag, 'Barcelona, Sants')

			// THEN it is refused. Stored, it would be split back into two tags no
			// company carries the moment anyone filtered by it, and every company
			// under it would quietly stop being findable
			expect(result._tag).toBe('Failure')
		})
	})

	describe('when it is ordinary text', () => {
		it('should be accepted as written, accents and spaces included', () => {
			// GIVEN the labels an organisation actually uses
			// THEN each is kept exactly as typed — a tag is free text, and only the
			// separator is out of bounds
			for (const tag of ['pilot', 'Q1 2026', 'Calderería', 'shortlist']) {
				const result = decode(CompanyTag, tag)
				expect(result._tag).toBe('Success')
				if (result._tag === 'Success') expect(result.value).toBe(tag)
			}
		})
	})

	describe('when it is empty', () => {
		it('should be refused rather than stored as a blank chip', () => {
			// GIVEN nothing typed
			// THEN there is no tag to write
			expect(decode(CompanyTag, '')._tag).toBe('Failure')
		})
	})
})

describe('a company sort order', () => {
	describe('when it is one the server holds', () => {
		it('should be accepted', () => {
			// GIVEN each order the list can be read in
			for (const sort of [
				'priority',
				'name',
				'recent_contact',
				'recent_update',
			]) {
				expect(decode(CompanySort, sort)._tag).toBe('Success')
			}
		})
	})

	describe('when it is a word the server does not know', () => {
		it('should be refused rather than quietly ignored', () => {
			// GIVEN an order nobody implements
			// THEN it is turned away at the door. Accepted, the caller would be sent
			// a list in priority order believing it had asked for something else,
			// with nothing in the answer to say otherwise
			expect(decode(CompanySort, 'newest')._tag).toBe('Failure')
			expect(decode(CompanySort, 'name_desc')._tag).toBe('Failure')
			expect(decode(CompanySort, '')._tag).toBe('Failure')
		})
	})
})
