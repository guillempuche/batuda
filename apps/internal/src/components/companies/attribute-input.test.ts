import { describe, expect, it } from 'vitest'

import { readAttributeInput } from '#/components/companies/attribute-input'

describe('readAttributeInput [attribute-input.ts]', () => {
	describe('when the box is emptied', () => {
		it('should clear the key whatever the kind', () => {
			// GIVEN every kind a declaration may take
			// WHEN the box comes back empty, blank or missing
			// THEN the key is cleared rather than stored as an empty value
			expect(readAttributeInput('text', null, [], 'en')).toEqual({
				outcome: 'clear',
			})
			expect(readAttributeInput('text', '   ', [], 'en')).toEqual({
				outcome: 'clear',
			})
			expect(readAttributeInput('number', '', [], 'en')).toEqual({
				outcome: 'clear',
			})
			expect(readAttributeInput('date', '', [], 'en')).toEqual({
				outcome: 'clear',
			})
			expect(readAttributeInput('boolean', '', [], 'en')).toEqual({
				outcome: 'clear',
			})
			expect(readAttributeInput('enum', '', ['blue'], 'en')).toEqual({
				outcome: 'clear',
			})
		})
	})

	describe('when a number is typed by an English reader', () => {
		it('should read it with the marks their own screen writes', () => {
			// GIVEN a number attribute and a reader whose thousands wear a comma
			// WHEN a number is typed back the way it is printed
			// THEN the comma groups and the dot starts the decimals
			expect(readAttributeInput('number', '12,500', [], 'en')).toEqual({
				outcome: 'value',
				value: 12500,
			})
			expect(readAttributeInput('number', '12.5', [], 'en')).toEqual({
				outcome: 'value',
				value: 12.5,
			})
			expect(readAttributeInput('number', '12', [], 'en')).toEqual({
				outcome: 'value',
				value: 12,
			})
			expect(readAttributeInput('number', '-3', [], 'en')).toEqual({
				outcome: 'value',
				value: -3,
			})
		})

		it('should refuse a comma that groups nothing', () => {
			// GIVEN an English reader, for whom a comma never starts decimals
			// WHEN one is typed where a dot belongs
			// THEN it is refused rather than read as twelve and a half
			expect(readAttributeInput('number', '12,5', [], 'en')).toEqual({
				outcome: 'invalid',
			})
		})
	})

	describe('when a number is typed by a Catalan reader', () => {
		it('should read it with the marks their own screen writes', () => {
			// GIVEN a number attribute and a reader whose thousands wear a dot
			// WHEN a number is typed back the way it is printed
			// THEN the dot groups and the comma starts the decimals
			expect(readAttributeInput('number', '1.200', [], 'ca')).toEqual({
				outcome: 'value',
				value: 1200,
			})
			expect(readAttributeInput('number', '12,5', [], 'ca')).toEqual({
				outcome: 'value',
				value: 12.5,
			})
			expect(readAttributeInput('number', '1.200,50', [], 'ca')).toEqual({
				outcome: 'value',
				value: 1200.5,
			})
			expect(readAttributeInput('number', '-0,75', [], 'ca')).toEqual({
				outcome: 'value',
				value: -0.75,
			})
		})

		it('should refuse marks that group nothing', () => {
			// GIVEN a Catalan reader
			// WHEN the marks fall where no number wears them
			// THEN it is refused rather than guessed at
			expect(readAttributeInput('number', '1,2,3', [], 'ca')).toEqual({
				outcome: 'invalid',
			})
			expect(readAttributeInput('number', '12.5', [], 'ca')).toEqual({
				outcome: 'invalid',
			})
		})
	})

	describe('when what is typed is not a number at all', () => {
		it('should refuse words, a half-written number and bad grouping', () => {
			// GIVEN a number attribute
			// WHEN words or a half-written number are typed
			// THEN the row refuses it instead of sending it to the server
			expect(readAttributeInput('number', 'twelve', [], 'en')).toEqual({
				outcome: 'invalid',
			})
			expect(readAttributeInput('number', '12 sites', [], 'en')).toEqual({
				outcome: 'invalid',
			})
			expect(readAttributeInput('number', '1.2.3', [], 'en')).toEqual({
				outcome: 'invalid',
			})
			expect(readAttributeInput('number', '12e', [], 'en')).toEqual({
				outcome: 'invalid',
			})
			expect(readAttributeInput('number', '1,20', [], 'en')).toEqual({
				outcome: 'invalid',
			})
		})

		it('should still read a number grouped with spaces', () => {
			// GIVEN a number written with the spaces some keyboards give
			// WHEN it is read
			// THEN the spaces are dropped, since no number means anything by them
			expect(readAttributeInput('number', '1 200', [], 'en')).toEqual({
				outcome: 'value',
				value: 1200,
			})
		})
	})

	describe('when a day is typed', () => {
		it('should take a real day and refuse one that does not exist', () => {
			// GIVEN a date attribute
			// WHEN a day is typed
			// THEN only a day the calendar has is stored
			expect(readAttributeInput('date', '2026-02-28', [], 'en')).toEqual({
				outcome: 'value',
				value: '2026-02-28',
			})
			expect(readAttributeInput('date', '2026-02-30', [], 'en')).toEqual({
				outcome: 'invalid',
			})
			expect(readAttributeInput('date', '28/02/2026', [], 'en')).toEqual({
				outcome: 'invalid',
			})
		})
	})

	describe('when a yes/no is picked', () => {
		it('should read the dropdown values as true and false', () => {
			// GIVEN the two values the yes/no dropdown carries
			// WHEN either is picked
			// THEN it is stored as a yes/no, not as the word
			expect(readAttributeInput('boolean', 'true', [], 'en')).toEqual({
				outcome: 'value',
				value: true,
			})
			expect(readAttributeInput('boolean', 'false', [], 'en')).toEqual({
				outcome: 'value',
				value: false,
			})
		})

		it('should refuse a word that is neither', () => {
			// GIVEN a yes/no attribute
			// WHEN something else arrives
			// THEN it is refused rather than guessed at
			expect(readAttributeInput('boolean', 'maybe', [], 'en')).toEqual({
				outcome: 'invalid',
			})
		})
	})

	describe('when a choice is picked', () => {
		it('should store the declared spelling of the word', () => {
			// GIVEN a choice declaring its words
			// WHEN one arrives in another case or without its accents
			// THEN the declared spelling is what gets stored
			expect(readAttributeInput('enum', 'ALMACÉN', ['Almacén'], 'en')).toEqual({
				outcome: 'value',
				value: 'Almacén',
			})
			expect(readAttributeInput('enum', 'almacen', ['Almacén'], 'en')).toEqual({
				outcome: 'value',
				value: 'Almacén',
			})
		})

		it('should refuse a word nobody declared', () => {
			// GIVEN a choice declaring its words
			// WHEN a word outside the list arrives
			// THEN it is refused
			expect(readAttributeInput('enum', 'garage', ['Almacén'], 'en')).toEqual({
				outcome: 'invalid',
			})
		})

		it('should refuse every word when nothing is declared', () => {
			// GIVEN a choice left with no words at all
			// WHEN anything is typed
			// THEN there is nothing to match, so it is refused
			expect(readAttributeInput('enum', 'blue', [], 'en')).toEqual({
				outcome: 'invalid',
			})
		})
	})

	describe('when text is typed', () => {
		it('should keep the trimmed text and refuse an overlong one', () => {
			// GIVEN a text attribute
			// WHEN a sentence is typed, and then one longer than the limit
			// THEN the first is stored trimmed and the second is refused
			expect(readAttributeInput('text', '  two ovens  ', [], 'en')).toEqual({
				outcome: 'value',
				value: 'two ovens',
			})
			expect(readAttributeInput('text', 'x'.repeat(2001), [], 'en')).toEqual({
				outcome: 'invalid',
			})
		})

		it('should leave the number marks alone for every other kind', () => {
			// GIVEN a text attribute holding a sentence with a comma
			// WHEN it is read for a Catalan reader, whose decimals wear one
			// THEN the comma stays where it was typed
			expect(
				readAttributeInput('text', 'two ovens, one fryer', [], 'ca'),
			).toEqual({ outcome: 'value', value: 'two ovens, one fryer' })
		})
	})
})
