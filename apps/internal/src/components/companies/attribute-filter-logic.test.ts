import { describe, expect, it } from 'vitest'

import {
	clampOp,
	opsFor,
	parseValueParam,
	valueParam,
} from './attribute-filter-logic'

// The words a choice attribute declares, in the spelling the settings page
// stored them in.
const FIT_WORDS = ['Strong', 'possible', 'weak']

describe('opsFor [attribute-filter-logic.ts]', () => {
	describe('when the kind compares as a quantity', () => {
		it('should offer the two range comparisons beside equality', () => {
			// GIVEN a number and a date
			// WHEN their comparisons are asked for
			// THEN both offer "at least" and "at most"
			expect(opsFor('number')).toEqual(['eq', 'gte', 'lte'])
			expect(opsFor('date')).toEqual(['eq', 'gte', 'lte'])
		})
	})

	describe('when the kind is a word', () => {
		it('should offer "one of" for a choice and also "contains" for free text', () => {
			// GIVEN a choice and free text
			// WHEN their comparisons are asked for
			// THEN only text can be searched inside
			expect(opsFor('enum')).toEqual(['eq', 'in'])
			expect(opsFor('text')).toEqual(['eq', 'in', 'contains'])
		})
	})

	describe('when the kind is yes/no', () => {
		it('should offer equality alone', () => {
			// GIVEN a yes/no attribute
			// WHEN its comparisons are asked for
			// THEN there is nothing to compare but the answer itself
			expect(opsFor('boolean')).toEqual(['eq'])
		})
	})
})

describe('clampOp [attribute-filter-logic.ts]', () => {
	describe('when the kind offers the comparison', () => {
		it('should keep it', () => {
			// GIVEN comparisons each kind declares
			// WHEN clamped
			// THEN they come back as asked
			expect(clampOp('text', 'contains')).toBe('contains')
			expect(clampOp('enum', 'in')).toBe('in')
			expect(clampOp('number', 'gte')).toBe('gte')
		})
	})

	describe('when the kind does not offer it', () => {
		it('should fall back to the comparison the kind starts on', () => {
			// GIVEN a link asking a yes/no for "at least", or a number for "contains"
			// WHEN clamped
			// THEN each lands on "is", which its kind does offer
			expect(clampOp('boolean', 'gte')).toBe('eq')
			expect(clampOp('number', 'contains')).toBe('eq')
			expect(clampOp('enum', 'lte')).toBe('eq')
		})
	})

	describe('when no comparison is chosen yet', () => {
		it('should start every kind on equality', () => {
			// GIVEN an attribute just picked, with nothing said about how to compare
			// WHEN clamped
			// THEN every kind starts on "is", the one a reader means by default
			expect(clampOp('text', null)).toBe('eq')
			expect(clampOp('number', null)).toBe('eq')
			expect(clampOp('enum', null)).toBe('eq')
			expect(clampOp('boolean', null)).toBe('eq')
			expect(clampOp('date', null)).toBe('eq')
		})
	})
})

describe('valueParam [attribute-filter-logic.ts]', () => {
	describe('when the value is a number', () => {
		it('should write the number back in its plain form', () => {
			// GIVEN a number typed with a leading zero and spaces
			// WHEN turned into an address value
			// THEN it reads as the number it means
			expect(valueParam('number', 'gte', '007', [])).toBe('7')
			expect(valueParam('number', 'lte', ' 1 200 ', [])).toBe('1200')
			expect(valueParam('number', 'eq', '12.50', [])).toBe('12.5')
			expect(valueParam('number', 'eq', '-3', [])).toBe('-3')
			expect(valueParam('number', 'eq', '0', [])).toBe('0')
		})

		it('should apply nothing for text that is not a number', () => {
			// GIVEN half a number, or none at all
			// WHEN turned into an address value
			// THEN there is nothing to narrow the list by
			expect(valueParam('number', 'gte', '', [])).toBeNull()
			expect(valueParam('number', 'gte', '   ', [])).toBeNull()
			expect(valueParam('number', 'gte', '3.', [])).toBeNull()
			expect(valueParam('number', 'gte', 'three', [])).toBeNull()
			expect(valueParam('number', 'gte', '-', [])).toBeNull()
		})
	})

	describe('when the value is a day', () => {
		it('should keep a real day and refuse one that does not exist', () => {
			// GIVEN a leap day and the thirtieth of February
			// WHEN turned into an address value
			// THEN only the day that exists is applied
			expect(valueParam('date', 'gte', ' 2024-02-29 ', [])).toBe('2024-02-29')
			expect(valueParam('date', 'eq', '2024-02-30', [])).toBeNull()
			expect(valueParam('date', 'eq', '2024-6-1', [])).toBeNull()
			expect(valueParam('date', 'eq', '', [])).toBeNull()
		})
	})

	describe('when the value is yes or no', () => {
		it('should travel as true or false whichever word was used', () => {
			// GIVEN the two answers, written as the select and as a link spell them
			// WHEN turned into an address value
			// THEN both reach the server's own words
			expect(valueParam('boolean', 'eq', 'true', [])).toBe('true')
			expect(valueParam('boolean', 'eq', ' YES ', [])).toBe('true')
			expect(valueParam('boolean', 'eq', 'no', [])).toBe('false')
			expect(valueParam('boolean', 'eq', 'maybe', [])).toBeNull()
			expect(valueParam('boolean', 'eq', '', [])).toBeNull()
		})
	})

	describe('when the value is text', () => {
		it('should trim it and apply nothing for whitespace alone', () => {
			// GIVEN a name with spaces around it, and a box holding only spaces
			// WHEN turned into an address value
			// THEN the name is trimmed and the blank box narrows nothing
			expect(valueParam('text', 'eq', '  Acme  ', [])).toBe('Acme')
			expect(valueParam('text', 'contains', '  metal ', [])).toBe('metal')
			expect(valueParam('text', 'contains', '   ', [])).toBeNull()
			expect(valueParam('text', 'eq', '', [])).toBeNull()
		})

		it('should apply nothing for text longer than a value may be', () => {
			// GIVEN text past the length a stored value allows, matched whole and
			// matched inside
			// WHEN turned into an address value
			// THEN both are refused here rather than by the server
			expect(valueParam('text', 'eq', 'a'.repeat(2001), [])).toBeNull()
			expect(valueParam('text', 'contains', 'a'.repeat(2001), [])).toBeNull()
		})
	})

	describe('when the value is a choice word', () => {
		it('should fold it to the spelling the declaration lists', () => {
			// GIVEN a declared word written in another case, with spaces around it
			// WHEN turned into an address value
			// THEN the declaration's own spelling is what travels
			expect(valueParam('enum', 'eq', ' strong ', FIT_WORDS)).toBe('Strong')
			expect(valueParam('enum', 'eq', 'POSSIBLE', FIT_WORDS)).toBe('possible')
		})

		it('should apply nothing for a word the declaration does not list', () => {
			// GIVEN a word that was declared once and is not any more, and an empty box
			// WHEN turned into an address value
			// THEN nothing is applied: the server answers such a word with a refusal,
			// and the page would go to an error state over a word nobody can see
			expect(valueParam('enum', 'eq', 'retired word', FIT_WORDS)).toBeNull()
			expect(valueParam('enum', 'eq', ' Molt gran ', FIT_WORDS)).toBeNull()
			expect(valueParam('enum', 'eq', '  ', FIT_WORDS)).toBeNull()
		})

		it('should apply nothing when the attribute declares no words at all', () => {
			// GIVEN a choice whose words have not arrived, or were all dropped
			// WHEN turned into an address value
			// THEN there is nothing a word could be held against
			expect(valueParam('enum', 'eq', 'strong', [])).toBeNull()
		})
	})

	describe('when the comparison is "one of"', () => {
		it('should trim, deduplicate and sort the words into one comma list', () => {
			// GIVEN a list ticked out of order, with a repeat
			// WHEN turned into an address value
			// THEN it is the canonical list a saved view matches, in the declared
			// spelling
			expect(
				valueParam('enum', 'in', ['strong', 'possible', 'strong'], FIT_WORDS),
			).toBe('Strong,possible')
		})

		it('should read a list typed by hand as well as one ticked', () => {
			// GIVEN a comma list typed into a text box, with spaces and a gap
			// WHEN turned into an address value
			// THEN it reads the same as the ticked list
			expect(valueParam('text', 'in', ' b , a ,, b', [])).toBe('a,b')
		})

		it('should keep a list of one, which is a filter like any other', () => {
			// GIVEN a single word ticked
			// WHEN turned into an address value
			// THEN it travels as that one word
			expect(valueParam('enum', 'in', ['strong'], FIT_WORDS)).toBe('Strong')
		})

		it('should leave out a word the declaration no longer lists', () => {
			// GIVEN a list where one word is declared and the other is not
			// WHEN turned into an address value
			// THEN the declared word still narrows the list, and the other is left out
			// rather than taking the whole filter with it
			expect(valueParam('enum', 'in', ['strong', 'retired'], FIT_WORDS)).toBe(
				'Strong',
			)
		})

		it('should apply nothing when no word of the list is declared any more', () => {
			// GIVEN a list of words the declaration has since dropped
			// WHEN turned into an address value
			// THEN there is nothing left to narrow by, and the caller lifts the
			// filter rather than asking for words nobody declares
			expect(
				valueParam('enum', 'in', ['retired', 'older'], FIT_WORDS),
			).toBeNull()
		})

		it('should apply nothing when a typed word is longer than a value may be', () => {
			// GIVEN a comma list with one word past the length a stored value allows
			// WHEN turned into an address value
			// THEN the list waits rather than being applied without that word
			expect(valueParam('text', 'in', `a,${'b'.repeat(2001)}`, [])).toBeNull()
		})

		it('should apply nothing for a list that names no word', () => {
			// GIVEN everything unticked, or a box holding only commas
			// WHEN turned into an address value
			// THEN there is nothing to narrow the list by
			expect(valueParam('enum', 'in', [], FIT_WORDS)).toBeNull()
			expect(valueParam('text', 'in', ' , ,', [])).toBeNull()
		})
	})
})

describe('parseValueParam [attribute-filter-logic.ts]', () => {
	describe('when the comparison is "one of"', () => {
		it('should give back the words as a list and as a readable line', () => {
			// GIVEN the comma list an address holds
			const parsed = parseValueParam('enum', 'in', 'possible,Strong', FIT_WORDS)
			// WHEN read back by the control
			// THEN the ticked words are a list, and the box shows them spaced out
			expect(parsed.values).toEqual(['Strong', 'possible'])
			expect(parsed.text).toBe('Strong, possible')
		})

		it('should tick one word once however a link spelled it', () => {
			// GIVEN a link naming one declared word twice, in two spellings
			const parsed = parseValueParam('enum', 'in', 'strong,Strong', FIT_WORDS)
			// WHEN read back by the control
			// THEN it is ticked once, under the spelling the declaration lists
			expect(parsed.values).toEqual(['Strong'])
		})

		it('should keep a word the declaration no longer lists', () => {
			// GIVEN a saved view naming a word that has since been dropped
			const parsed = parseValueParam('enum', 'in', 'retired,strong', FIT_WORDS)
			// WHEN read back by the control
			// THEN it is still ticked, so it can be read and taken off the filter
			expect(parsed.values).toEqual(['Strong', 'retired'])
		})

		it('should drop the blanks in a list somebody typed', () => {
			// GIVEN a hand-written link with a trailing comma
			// WHEN read back by the control
			// THEN only the words remain
			expect(parseValueParam('text', 'in', 'a,,b,', []).values).toEqual([
				'a',
				'b',
			])
		})

		it('should give back no words for an empty value', () => {
			// GIVEN nothing after the equals sign
			// WHEN read back by the control
			// THEN nothing is ticked
			expect(parseValueParam('enum', 'in', '', FIT_WORDS).values).toEqual([])
		})
	})

	describe('when the value is a single choice word', () => {
		it('should give back the spelling the declaration lists', () => {
			// GIVEN a link written in another case
			// WHEN read back by the control
			// THEN the dropdown points at its own option rather than at a second
			// spelling of it
			expect(parseValueParam('enum', 'eq', 'strong', FIT_WORDS).text).toBe(
				'Strong',
			)
		})

		it('should keep a word the declaration no longer lists', () => {
			// GIVEN a word that was declared once and is not any more
			// WHEN read back by the control
			// THEN it comes back as written, so it can be shown and taken off
			expect(parseValueParam('enum', 'eq', 'retired', FIT_WORDS).text).toBe(
				'retired',
			)
		})
	})

	describe('when the value is yes or no', () => {
		it('should spell it the way the two options are spelled', () => {
			// GIVEN a link written with the word a person would use
			// WHEN read back by the control
			// THEN it matches the option the select holds
			expect(parseValueParam('boolean', 'eq', 'yes', []).text).toBe('true')
			expect(parseValueParam('boolean', 'eq', 'false', []).text).toBe('false')
		})

		it('should keep a word that is neither answer', () => {
			// GIVEN a link carrying a word that is neither yes nor no
			// WHEN read back by the control
			// THEN it comes back as written, so the control can show it and the
			// reader can take it off
			expect(parseValueParam('boolean', 'eq', 'perhaps', []).text).toBe(
				'perhaps',
			)
		})
	})

	describe('when the value is a single one of any other kind', () => {
		it('should give back the trimmed text and no ticked words', () => {
			// GIVEN a number and a day from the address
			// WHEN read back by the control
			// THEN each fills the box as written, with nothing ticked
			expect(parseValueParam('number', 'gte', ' 12 ', [])).toEqual({
				text: '12',
				values: [],
			})
			expect(parseValueParam('date', 'lte', '2024-02-29', [])).toEqual({
				text: '2024-02-29',
				values: [],
			})
		})
	})
})
