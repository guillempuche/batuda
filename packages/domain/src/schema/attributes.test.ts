import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	ATTRIBUTE_KEY_PATTERN,
	ATTRIBUTE_OPS,
	ATTRIBUTE_RESERVED_KEYS,
	ATTRIBUTE_TEXT_MAX,
	CompanyAttributesInput,
	coerceAttributeValue,
	isCalendarDay,
	OPS_FOR_KIND,
} from './attributes'

const decodeInput = (input: unknown) =>
	Schema.decodeUnknownExit(CompanyAttributesInput)(input)

describe('ATTRIBUTE_KEY_PATTERN', () => {
	describe('when the key has the slug shape', () => {
		it('should accept two characters and refuse one', () => {
			// GIVEN the shortest keys
			// THEN two characters is the floor
			expect(ATTRIBUTE_KEY_PATTERN.test('ab')).toBe(true)
			expect(ATTRIBUTE_KEY_PATTERN.test('a')).toBe(false)
		})

		it('should accept sixty-four characters and refuse sixty-five', () => {
			// GIVEN keys at the length boundary
			// THEN sixty-four is the ceiling
			expect(ATTRIBUTE_KEY_PATTERN.test(`a${'b'.repeat(63)}`)).toBe(true)
			expect(ATTRIBUTE_KEY_PATTERN.test(`a${'b'.repeat(64)}`)).toBe(false)
		})

		it('should refuse anything but lowercase letters, digits and underscores after a letter', () => {
			// GIVEN keys that start wrong or carry the wrong characters
			// THEN every one is refused, including a trailing line break
			for (const key of [
				'1size',
				'_size',
				'Size',
				'a-b',
				'a b',
				'tamañó',
				'ab\n',
				'',
				'  ',
			])
				expect(ATTRIBUTE_KEY_PATTERN.test(key)).toBe(false)
		})
	})
})

describe('ATTRIBUTE_RESERVED_KEYS', () => {
	describe('when a key names something a research run already fills', () => {
		it('should hold the run fields, the nested names the checks act on and the prototype names', () => {
			// GIVEN keys with a legal shape that mean something else already
			// THEN each is reserved
			for (const key of [
				'industry',
				'website',
				'attributes',
				'value',
				'as_of',
				'role',
				'constructor',
				'prototype',
			])
				expect(ATTRIBUTE_RESERVED_KEYS.has(key)).toBe(true)
		})

		it('should not reach inherited object names, being a Set', () => {
			// GIVEN a name every object inherits
			// THEN it is not reserved by accident
			expect(ATTRIBUTE_RESERVED_KEYS.has('toString')).toBe(false)
		})
	})
})

describe('isCalendarDay', () => {
	describe('when the text does not have the year-month-day shape', () => {
		it('should refuse single-digit parts, a time suffix, surrounding spaces and no dashes', () => {
			// GIVEN texts that name a day some other way
			// THEN none is read as a day; the caller trims first
			for (const text of [
				'2024-2-3',
				'2024-01-05T00:00:00Z',
				'2024-01-05 ',
				'20240105',
				'',
			])
				expect(isCalendarDay(text)).toBe(false)
		})
	})

	describe('when the shape is right but the day does not exist', () => {
		it('should refuse a day past the end of its month and a month past twelve', () => {
			// GIVEN dates that look right and are not
			// THEN the calendar says no
			for (const text of [
				'2024-02-30',
				'2023-02-29',
				'2024-13-01',
				'2024-00-10',
				'2024-01-00',
				'2024-01-32',
			])
				expect(isCalendarDay(text)).toBe(false)
		})

		it('should accept a leap day only in a leap year', () => {
			// GIVEN the twenty-ninth of February across the century rules
			// THEN only real leap days pass
			expect(isCalendarDay('2024-02-29')).toBe(true)
			expect(isCalendarDay('2000-02-29')).toBe(true)
			expect(isCalendarDay('1900-02-29')).toBe(false)
		})

		it('should accept a year below one hundred as written', () => {
			// GIVEN a four-digit year that starts with two zeros
			// THEN it is the year it says, not the nineteen hundreds
			expect(isCalendarDay('0099-05-05')).toBe(true)
			expect(isCalendarDay('0004-02-29')).toBe(true)
		})
	})
})

describe('coerceAttributeValue', () => {
	describe('when the kind is number', () => {
		it('should pass a finite number through and refuse NaN and infinity', () => {
			// GIVEN numbers of every kind
			// THEN only the finite one survives
			expect(coerceAttributeValue('number', 42, null)).toBe(42)
			expect(coerceAttributeValue('number', Number.NaN, null)).toBeNull()
			expect(
				coerceAttributeValue('number', Number.POSITIVE_INFINITY, null),
			).toBeNull()
			expect(
				coerceAttributeValue('number', Number.NEGATIVE_INFINITY, null),
			).toBeNull()
		})

		it('should read a number written as text, dropping the spaces that group it', () => {
			// GIVEN numbers as people and pages write them
			// THEN each reads as one number
			expect(coerceAttributeValue('number', ' 12 ', null)).toBe(12)
			expect(coerceAttributeValue('number', '1 200', null)).toBe(1200)
			expect(coerceAttributeValue('number', '12.50', null)).toBe(12.5)
			expect(coerceAttributeValue('number', '-3', null)).toBe(-3)
			expect(coerceAttributeValue('number', '007', null)).toBe(7)
		})

		it('should refuse exponents, signs, commas, bare dots, units and blanks', () => {
			// GIVEN spellings the plain shape does not cover
			// THEN none reads as a number
			for (const text of ['1e3', '+5', '1,000', '.5', '5.', '12px', ''])
				expect(coerceAttributeValue('number', text, null)).toBeNull()
		})

		it('should refuse a digit string too long to be finite', () => {
			// GIVEN four hundred nines
			// THEN the shape passes and the number does not
			expect(coerceAttributeValue('number', '9'.repeat(400), null)).toBeNull()
		})

		it('should refuse a boolean, null or an object', () => {
			// GIVEN raw values of other types
			// THEN none reads as a number
			expect(coerceAttributeValue('number', true, null)).toBeNull()
			expect(coerceAttributeValue('number', null, null)).toBeNull()
			expect(coerceAttributeValue('number', {}, null)).toBeNull()
		})
	})

	describe('when the kind is boolean', () => {
		it('should pass a real boolean through, false included', () => {
			// GIVEN false, which a caller must not mistake for a refusal
			// THEN it comes back as false, not null
			expect(coerceAttributeValue('boolean', false, null)).toBe(false)
			expect(coerceAttributeValue('boolean', true, null)).toBe(true)
		})

		it('should read the four words in any case with spaces around them', () => {
			// GIVEN the words a page or a person writes
			// THEN each reads as its boolean
			expect(coerceAttributeValue('boolean', 'TRUE', null)).toBe(true)
			expect(coerceAttributeValue('boolean', ' yes ', null)).toBe(true)
			expect(coerceAttributeValue('boolean', 'False', null)).toBe(false)
			expect(coerceAttributeValue('boolean', 'NO', null)).toBe(false)
		})

		it('should refuse other spellings and numbers', () => {
			// GIVEN spellings that might mean yes or no
			// THEN none is guessed at
			for (const raw of ['1', '0', 'y', 'n', 'sí', 'on', '', '  ', 1, 0])
				expect(coerceAttributeValue('boolean', raw, null)).toBeNull()
		})
	})

	describe('when the kind is date', () => {
		it('should return the trimmed text of a real day', () => {
			// GIVEN a day with spaces around it
			// THEN the day is stored as its text
			expect(coerceAttributeValue('date', '  2024-02-29  ', null)).toBe(
				'2024-02-29',
			)
		})

		it('should refuse a day that does not exist, a loose shape and a timestamp', () => {
			// GIVEN texts that are not a calendar day
			// THEN none is read
			for (const text of ['2024-02-30', '2024-2-3', '2024-01-05T10:00:00Z'])
				expect(coerceAttributeValue('date', text, null)).toBeNull()
		})

		it('should refuse a Date object and a number', () => {
			// GIVEN a date in another form
			// THEN only text is read
			expect(coerceAttributeValue('date', new Date(), null)).toBeNull()
			expect(coerceAttributeValue('date', 1_700_000_000_000, null)).toBeNull()
		})
	})

	describe('when the kind is enum', () => {
		it('should return the declared spelling, not the one given', () => {
			// GIVEN a choice written in capitals
			// THEN the stored word is the declared one
			expect(
				coerceAttributeValue('enum', 'MOLT GRAN', ['Molt gran', 'Petit']),
			).toBe('Molt gran')
		})

		it('should match across accents and punctuation', () => {
			// GIVEN a choice written with an accent and a dash
			// THEN it still finds its word
			expect(
				coerceAttributeValue('enum', 'MÉTAL-FABRICATION', [
					'Metal fabrication',
				]),
			).toBe('Metal fabrication')
		})

		it('should return the first word when two declared words fold the same', () => {
			// GIVEN two spellings of one word
			// THEN the first declared wins
			expect(coerceAttributeValue('enum', 'GRAN', ['Gran', 'grán'])).toBe(
				'Gran',
			)
		})

		it('should refuse a choice that folds to nothing or has no words to match', () => {
			// GIVEN punctuation only, and a declaration without words
			// THEN nothing matches
			expect(coerceAttributeValue('enum', '---', ['Gran'])).toBeNull()
			expect(coerceAttributeValue('enum', '   ', ['Gran'])).toBeNull()
			expect(coerceAttributeValue('enum', 'gran', null)).toBeNull()
			expect(coerceAttributeValue('enum', 'gran', [])).toBeNull()
		})

		it('should refuse a number even when a word prints the same', () => {
			// GIVEN the number one and the word "1"
			// THEN only text is matched
			expect(coerceAttributeValue('enum', 1, ['1'])).toBeNull()
		})
	})

	describe('when the kind is text', () => {
		it('should trim and keep the text', () => {
			// GIVEN text with spaces around it
			// THEN the spaces go
			expect(coerceAttributeValue('text', '  hola  ', null)).toBe('hola')
		})

		it('should refuse empty and whitespace-only text', () => {
			// GIVEN nothing to keep
			// THEN it is refused rather than stored blank
			expect(coerceAttributeValue('text', '', null)).toBeNull()
			expect(coerceAttributeValue('text', '\n\t ', null)).toBeNull()
		})

		it('should accept the cap exactly and refuse one more, measured after trimming', () => {
			// GIVEN text at the boundary
			// THEN the trim runs before the count
			expect(
				coerceAttributeValue('text', 'a'.repeat(ATTRIBUTE_TEXT_MAX), null),
			).toHaveLength(ATTRIBUTE_TEXT_MAX)
			expect(
				coerceAttributeValue(
					'text',
					` ${'a'.repeat(ATTRIBUTE_TEXT_MAX)} `,
					null,
				),
			).toHaveLength(ATTRIBUTE_TEXT_MAX)
			expect(
				coerceAttributeValue('text', 'a'.repeat(ATTRIBUTE_TEXT_MAX + 1), null),
			).toBeNull()
		})

		it('should keep text that happens to look like a bad date or a number', () => {
			// GIVEN text under a text key
			// THEN no other kind's rule applies
			expect(coerceAttributeValue('text', '2024-02-30', null)).toBe(
				'2024-02-30',
			)
			expect(coerceAttributeValue('text', '1e3', null)).toBe('1e3')
		})

		it('should refuse a number, a boolean and null', () => {
			// GIVEN raw values of other types
			// THEN text means text
			expect(coerceAttributeValue('text', 5, null)).toBeNull()
			expect(coerceAttributeValue('text', true, null)).toBeNull()
			expect(coerceAttributeValue('text', null, null)).toBeNull()
		})
	})
})

describe('coerceAttributeValue with a kind the code does not know', () => {
	describe('when the kind was written by hand into the database', () => {
		it('should read nothing rather than a value with no rule', () => {
			// GIVEN a kind outside the five
			// THEN no value reads as it
			expect(coerceAttributeValue('json' as never, 'x', null)).toBeNull()
		})
	})
})

describe('OPS_FOR_KIND', () => {
	describe('when a kind is asked which filters fit it', () => {
		it('should give ranges to numbers and dates only, contains to text only, lists to text and choices', () => {
			// GIVEN the table
			// THEN it reads as documented
			expect(OPS_FOR_KIND.text).toEqual(['eq', 'in', 'contains'])
			expect(OPS_FOR_KIND.enum).toEqual(['eq', 'in'])
			expect(OPS_FOR_KIND.boolean).toEqual(['eq'])
			expect(OPS_FOR_KIND.number).toEqual(['eq', 'gte', 'lte'])
			expect(OPS_FOR_KIND.date).toEqual(['eq', 'gte', 'lte'])
		})

		it('should only name operators that exist', () => {
			// GIVEN every operator in the table
			// THEN each is one of the declared operators
			for (const ops of Object.values(OPS_FOR_KIND))
				for (const op of ops) expect(ATTRIBUTE_OPS).toContain(op)
		})
	})
})

describe('CompanyAttributesInput', () => {
	describe('when a caller sends values', () => {
		it('should accept a bare string, number, boolean, null and the wrapped form', () => {
			// GIVEN one of each shape
			// THEN the record decodes
			const exit = decodeInput({
				a1: 'x',
				a2: 3,
				a3: true,
				a4: null,
				a5: { value: 'x', source_id: 's1', quote: 'q', as_of: '2024-01-01' },
			})
			expect(exit._tag).toBe('Success')
		})

		it('should refuse NaN both bare and wrapped', () => {
			// GIVEN a number that is not a number
			// THEN the finite rule refuses it either way
			expect(decodeInput({ ab: Number.NaN })._tag).toBe('Failure')
			expect(decodeInput({ ab: { value: Number.NaN } })._tag).toBe('Failure')
		})

		it('should refuse a wrapper with a null value or a non-text note', () => {
			// GIVEN a wrapper that is not a value with notes
			// THEN it is refused
			expect(decodeInput({ ab: { value: null } })._tag).toBe('Failure')
			expect(decodeInput({ ab: { value: 'x', as_of: 2024 } })._tag).toBe(
				'Failure',
			)
		})
	})

	describe('when a key could never be declared', () => {
		it('should admit it here and leave the refusal to the write rules, which name the key', () => {
			// GIVEN keys with a capital, one character, and a name the run uses
			// THEN the record passes them; a key nobody can declare is refused
			// later as undeclared
			expect(decodeInput({ Size: 'x' })._tag).toBe('Success')
			expect(decodeInput({ a: 'x' })._tag).toBe('Success')
			expect(decodeInput({ industry: 'x' })._tag).toBe('Success')
		})
	})
})
