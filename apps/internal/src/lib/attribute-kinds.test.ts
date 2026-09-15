import { describe, expect, it } from 'vitest'

import {
	attributeEditText,
	formatAttributeValue,
	inferKind,
} from './attribute-kinds'

const words = { locale: 'en-GB', unit: null, yes: 'Yes', no: 'No' }

describe('formatAttributeValue [attribute-kinds.ts]', () => {
	describe('when the kind is a number', () => {
		it('should write the number in the locale digits with its unit after', () => {
			// GIVEN a number attribute with a unit
			// WHEN formatted for a reader in Spain
			const text = formatAttributeValue('number', 1200, {
				...words,
				locale: 'es-ES',
				unit: 'sites',
			})
			// THEN four digits are left ungrouped, as Spanish writes them, and the
			// unit follows
			expect(text).toBe('1200 sites')
		})

		it('should group a Catalan reader thousands with a dot', () => {
			// GIVEN the same number and unit read in Catalan
			// WHEN formatted
			// THEN the thousands wear the dot Catalan groups them with
			expect(
				formatAttributeValue('number', 1200, {
					...words,
					locale: 'ca',
					unit: 'sites',
				}),
			).toBe('1.200 sites')
		})

		it('should group a large number and leave out an empty unit', () => {
			// GIVEN a number past a thousand grouping and no unit
			// WHEN formatted for an English reader
			// THEN the thousands separator appears and nothing follows
			expect(
				formatAttributeValue('number', 12500, { ...words, unit: '' }),
			).toBe('12,500')
		})

		it('should keep each locale its own digits however often it is asked', () => {
			// GIVEN the same number read by a German and by an English reader
			const german = { ...words, locale: 'de-DE' }
			// WHEN each locale is formatted twice, so the second reuses a kept formatter
			// THEN neither reader is ever handed the other's grouping
			expect(formatAttributeValue('number', 12500, german)).toBe('12.500')
			expect(formatAttributeValue('number', 12500, words)).toBe('12,500')
			expect(formatAttributeValue('number', 12500, german)).toBe('12.500')
			expect(formatAttributeValue('number', 12500, words)).toBe('12,500')
		})

		it('should keep zero rather than reading it as nothing', () => {
			// GIVEN a zero
			// WHEN formatted
			// THEN it is written out
			expect(formatAttributeValue('number', 0, words)).toBe('0')
		})

		it('should fall back to the text when the stored value is not a number', () => {
			// GIVEN a number attribute holding text from before its kind was pinned
			// WHEN formatted
			// THEN the text is shown as stored
			expect(formatAttributeValue('number', 'many', words)).toBe('many')
		})
	})

	describe('when the kind is yes/no', () => {
		it('should use the reader words for true and false', () => {
			// GIVEN a yes and a no
			// WHEN formatted
			// THEN each reads in the words given
			expect(formatAttributeValue('boolean', true, words)).toBe('Yes')
			expect(formatAttributeValue('boolean', false, words)).toBe('No')
		})
	})

	describe('when the kind is a date', () => {
		it('should write a calendar day as a date', () => {
			// GIVEN an ISO day
			// WHEN formatted for an English reader
			// THEN it reads as a medium date, not as the raw text
			expect(formatAttributeValue('date', '2026-06-01', words)).toBe(
				'1 Jun 2026',
			)
		})

		it('should show a value that is not a day as stored', () => {
			// GIVEN a date attribute holding a year alone
			// WHEN formatted
			// THEN the text is shown as stored rather than parsed into a wrong day
			expect(formatAttributeValue('date', '2026', words)).toBe('2026')
		})
	})

	describe('when the kind is text or a choice', () => {
		it('should show the value as stored', () => {
			// GIVEN a text and a choice word
			// WHEN formatted
			// THEN both come back unchanged
			expect(formatAttributeValue('text', 'Notion', words)).toBe('Notion')
			expect(formatAttributeValue('enum', 'strong', words)).toBe('strong')
		})
	})
})

describe('attributeEditText [attribute-kinds.ts]', () => {
	it('should write a number with the reader own decimal mark and no grouping', () => {
		// GIVEN a decimal and a number past a thousand
		// WHEN each is put in the box to be edited
		// THEN the decimal wears the reader's mark and the thousands wear none,
		// so what is typed back is read the same way it was shown
		expect(attributeEditText('number', 12.5, 'en')).toBe('12.5')
		expect(attributeEditText('number', 12.5, 'ca')).toBe('12,5')
		expect(attributeEditText('number', 1200, 'en')).toBe('1200')
		expect(attributeEditText('number', 1200, 'ca')).toBe('1200')
	})

	it('should keep every digit that was stored', () => {
		// GIVEN a number with more decimals than a reading would print
		// WHEN it is put in the box
		// THEN none of them are rounded away, since the box saves back what it holds
		expect(attributeEditText('number', 12.345678, 'en')).toBe('12.345678')
	})

	it('should edit every other kind as stored', () => {
		// GIVEN a day, a yes/no and a choice word
		// WHEN each is put in the box
		// THEN it is the stored text that gets edited, whatever the reader's marks
		expect(attributeEditText('date', '2026-06-01', 'ca')).toBe('2026-06-01')
		expect(attributeEditText('boolean', true, 'ca')).toBe('true')
		expect(attributeEditText('enum', 'strong', 'ca')).toBe('strong')
		expect(attributeEditText('text', 'Notion', 'ca')).toBe('Notion')
	})
})

describe('inferKind [attribute-kinds.ts]', () => {
	it('should read a number, a yes/no, a day and any other text', () => {
		// GIVEN one value of each shape
		// WHEN the kind is inferred
		// THEN each reads as the kind that shows it right
		expect(inferKind(4)).toBe('number')
		expect(inferKind(false)).toBe('boolean')
		expect(inferKind('2026-06-01')).toBe('date')
		expect(inferKind('2026-13-01')).toBe('text')
		expect(inferKind('Excel')).toBe('text')
	})
})
