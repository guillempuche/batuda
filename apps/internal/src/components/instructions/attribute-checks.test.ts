import { describe, expect, it } from 'vitest'

import {
	ATTRIBUTE_DESCRIPTION_MAX,
	ATTRIBUTE_ENUM_VALUE_MAX,
	ATTRIBUTE_LABEL_MAX,
	ATTRIBUTE_UNIT_MAX,
} from '@batuda/domain'

import {
	type AttributeDraft,
	checkDraft,
	fieldForOutcome,
	formatChoices,
	parseChoices,
} from './attribute-checks'

// A draft that passes every check, so each case below changes one thing.
const good: AttributeDraft = {
	key: 'site_count',
	label: 'Number of sites',
	kind: 'number',
	enumValues: [],
	unit: 'sites',
	description: 'Premises the company runs.',
}

describe('checkDraft [attribute-checks.ts]', () => {
	describe('when the draft is well formed', () => {
		it('should find nothing to say', () => {
			// GIVEN a complete draft
			// WHEN checked
			// THEN nothing is wrong
			expect(checkDraft(good)).toBeNull()
		})

		it('should accept a choice with its words', () => {
			// GIVEN a choice kind carrying two words
			const draft = {
				...good,
				kind: 'enum',
				enumValues: ['own fleet', 'hired'],
			}
			// WHEN checked
			// THEN nothing is wrong
			expect(checkDraft(draft)).toBeNull()
		})
	})

	describe('when the key is being set', () => {
		it('should refuse a key that does not read as one', () => {
			// GIVEN keys starting with a digit, holding a capital, a dash or a space
			// WHEN each is checked
			// THEN each is refused as an unusable key
			for (const key of [
				'1site',
				'Site',
				'site-count',
				'site count',
				'_site',
			]) {
				expect(checkDraft({ ...good, key })).toBe('invalid_key')
			}
		})

		it('should refuse a key of one character and accept two', () => {
			// GIVEN the shortest key the pattern allows and one shorter
			// WHEN both are checked
			// THEN only the two-character one passes
			expect(checkDraft({ ...good, key: 'a' })).toBe('invalid_key')
			expect(checkDraft({ ...good, key: 'ab' })).toBeNull()
		})

		it('should accept 64 characters and refuse 65', () => {
			// GIVEN a key at the length limit and one past it
			// WHEN both are checked
			// THEN only the one at the limit passes
			expect(checkDraft({ ...good, key: `a${'b'.repeat(63)}` })).toBeNull()
			expect(checkDraft({ ...good, key: `a${'b'.repeat(64)}` })).toBe(
				'invalid_key',
			)
		})

		it('should refuse a name a research run already uses', () => {
			// GIVEN a key that is a field of a run's own findings
			// WHEN checked
			// THEN it is refused as reserved rather than as badly shaped
			expect(checkDraft({ ...good, key: 'website' })).toBe('reserved_key')
			expect(checkDraft({ ...good, key: 'constructor' })).toBe('reserved_key')
		})

		it('should read a key with spaces around it', () => {
			// GIVEN a key pasted with surrounding spaces
			// WHEN checked
			// THEN the spaces are not held against it
			expect(checkDraft({ ...good, key: '  site_count  ' })).toBeNull()
		})
	})

	describe('when the key is fixed', () => {
		it('should leave a reserved key alone while editing', () => {
			// GIVEN an existing declaration whose key became reserved later, so the
			// form does not offer the key at all
			const draft = { ...good, key: null }
			// WHEN checked
			// THEN the key is not checked and the edit may go ahead
			expect(checkDraft(draft)).toBeNull()
		})
	})

	describe('when the name is missing or too long', () => {
		it('should ask for a name that is blank or only spaces', () => {
			// GIVEN an empty name and one of spaces
			// WHEN each is checked
			// THEN both are refused as missing
			expect(checkDraft({ ...good, label: '' })).toBe('label_required')
			expect(checkDraft({ ...good, label: '   ' })).toBe('label_required')
		})

		it('should accept the longest name and refuse one character more', () => {
			// GIVEN a name at the cap and one past it
			const atCap = 'a'.repeat(ATTRIBUTE_LABEL_MAX)
			// WHEN both are checked
			// THEN only the one at the cap passes
			expect(checkDraft({ ...good, label: atCap })).toBeNull()
			expect(checkDraft({ ...good, label: `${atCap}a` })).toBe('label_too_long')
		})

		it('should refuse a name carrying a line break', () => {
			// GIVEN a pasted two-line name
			// WHEN checked
			// THEN it is refused for not fitting on one line
			expect(checkDraft({ ...good, label: 'Sites\nrun' })).toBe(
				'label_not_one_line',
			)
			expect(checkDraft({ ...good, label: 'Sites\r\nrun' })).toBe(
				'label_not_one_line',
			)
		})
	})

	describe('when the kind is not one of the five', () => {
		it('should ask for a kind it knows', () => {
			// GIVEN a kind the app does not have
			// WHEN checked
			// THEN it is refused
			expect(checkDraft({ ...good, kind: 'money' })).toBe('unknown_kind')
			expect(checkDraft({ ...good, kind: '' })).toBe('unknown_kind')
		})
	})

	describe('when the kind is a choice', () => {
		it('should ask for at least one word', () => {
			// GIVEN a choice with no words
			// WHEN checked
			// THEN it asks for the words a value may take
			expect(checkDraft({ ...good, kind: 'enum', enumValues: [] })).toBe(
				'enum_values_required',
			)
		})

		it('should accept the longest word and refuse one character more', () => {
			// GIVEN a word at the cap and one past it
			const atCap = 'a'.repeat(ATTRIBUTE_ENUM_VALUE_MAX)
			// WHEN both are checked
			// THEN only the one at the cap passes
			expect(
				checkDraft({ ...good, kind: 'enum', enumValues: [atCap] }),
			).toBeNull()
			expect(
				checkDraft({ ...good, kind: 'enum', enumValues: [`${atCap}a`] }),
			).toBe('enum_value_invalid')
		})

		it('should refuse the same word written twice', () => {
			// GIVEN two spellings of one word, which would leave a filter with two
			// entries for the same answer
			const draft = {
				...good,
				kind: 'enum',
				enumValues: ['Own fleet', 'own fleet'],
			}
			// WHEN checked
			// THEN it is refused
			expect(checkDraft(draft)).toBe('enum_value_invalid')
		})

		it('should refuse a word that is only punctuation', () => {
			// GIVEN a word with no letters or digits in it
			// WHEN checked
			// THEN it is refused, because nothing about it can be matched
			expect(checkDraft({ ...good, kind: 'enum', enumValues: ['---'] })).toBe(
				'enum_value_invalid',
			)
		})

		it('should keep words in other writing systems', () => {
			// GIVEN two words in Cyrillic, which a Latin-only rule folds to nothing
			const draft = { ...good, kind: 'enum', enumValues: ['своя', 'наёмная'] }
			// WHEN checked
			// THEN both stand as different words
			expect(checkDraft(draft)).toBeNull()
		})
	})

	describe('when a kind that is not a choice carries words', () => {
		it('should say only a choice takes a list', () => {
			// GIVEN a number with words attached
			// WHEN checked
			// THEN it is refused
			expect(checkDraft({ ...good, kind: 'number', enumValues: ['a'] })).toBe(
				'enum_values_not_allowed',
			)
		})
	})

	describe('when the unit or the note runs long', () => {
		it('should accept the longest unit and refuse one character more', () => {
			// GIVEN a unit at the cap and one past it
			const atCap = 'a'.repeat(ATTRIBUTE_UNIT_MAX)
			// WHEN both are checked
			// THEN only the one at the cap passes
			expect(checkDraft({ ...good, unit: atCap })).toBeNull()
			expect(checkDraft({ ...good, unit: `${atCap}a` })).toBe('unit_too_long')
		})

		it('should accept the longest note and refuse one character more', () => {
			// GIVEN a note at the cap and one past it
			const atCap = 'a'.repeat(ATTRIBUTE_DESCRIPTION_MAX)
			// WHEN both are checked
			// THEN only the one at the cap passes
			expect(checkDraft({ ...good, description: atCap })).toBeNull()
			expect(checkDraft({ ...good, description: `${atCap}a` })).toBe(
				'description_too_long',
			)
		})

		it('should measure a unit and a note without their spaces', () => {
			// GIVEN a unit and a note that only pass once trimmed
			const draft = {
				...good,
				unit: `  ${'a'.repeat(ATTRIBUTE_UNIT_MAX)}  `,
				description: `  ${'a'.repeat(ATTRIBUTE_DESCRIPTION_MAX)}  `,
			}
			// WHEN checked
			// THEN the spaces are not counted
			expect(checkDraft(draft)).toBeNull()
		})
	})

	describe('when more than one thing is wrong', () => {
		it('should complain about the key before the name', () => {
			// GIVEN a bad key and a missing name at the same time
			const draft = { ...good, key: 'Site', label: '' }
			// WHEN checked
			// THEN the key comes first, the order the server checks in
			expect(checkDraft(draft)).toBe('invalid_key')
		})
	})
})

describe('parseChoices [attribute-checks.ts]', () => {
	describe('when reading one comma-separated field', () => {
		it('should split on commas and drop the spaces', () => {
			// GIVEN words typed with uneven spacing
			// WHEN parsed
			// THEN each word stands on its own, trimmed
			expect(parseChoices('own fleet,  hired ,both')).toEqual([
				'own fleet',
				'hired',
				'both',
			])
		})

		it('should drop blanks so a trailing comma is not a word', () => {
			// GIVEN a trailing comma and a double comma
			// WHEN parsed
			// THEN only the real words come back
			expect(parseChoices('a,,b,')).toEqual(['a', 'b'])
		})

		it('should read an empty field as no words', () => {
			// GIVEN an empty field and one of spaces
			// WHEN parsed
			// THEN there are no words
			expect(parseChoices('')).toEqual([])
			expect(parseChoices('   ')).toEqual([])
		})
	})
})

describe('formatChoices [attribute-checks.ts]', () => {
	describe('when putting declared words back in the field', () => {
		it('should read back as what was typed', () => {
			// GIVEN words as declared
			const words = ['own fleet', 'hired']
			// WHEN written into the field and read out again
			// THEN the same words come back
			expect(formatChoices(words)).toBe('own fleet, hired')
			expect(parseChoices(formatChoices(words))).toEqual(words)
		})

		it('should leave the field empty when nothing is declared', () => {
			// GIVEN no words
			// WHEN written into the field
			// THEN the field is empty
			expect(formatChoices([])).toBe('')
		})
	})
})

describe('fieldForOutcome [attribute-checks.ts]', () => {
	describe('when the refusal is about one box', () => {
		it('should name the box it belongs beside', () => {
			// GIVEN refusals the server ties to one field
			// WHEN each is placed
			// THEN it lands on that field
			expect(fieldForOutcome('invalid_key')).toBe('key')
			expect(fieldForOutcome('duplicate_key')).toBe('key')
			expect(fieldForOutcome('label_too_long')).toBe('label')
			expect(fieldForOutcome('unknown_kind')).toBe('kind')
			expect(fieldForOutcome('enum_value_invalid')).toBe('enumValues')
			expect(fieldForOutcome('unit_too_long')).toBe('unit')
			expect(fieldForOutcome('description_too_long')).toBe('description')
		})
	})

	describe('when the refusal is about the whole write', () => {
		it('should name no box, so it is shown on its own', () => {
			// GIVEN refusals about who may write, where it lands, or the key elsewhere
			// WHEN each is placed
			// THEN none belongs to a field
			for (const outcome of [
				'forbidden',
				'not_found',
				'unknown_stack',
				'too_many_active',
				'kind_mismatch',
				'key_in_use',
				'agent_not_research',
				'stack_not_org',
			]) {
				expect(fieldForOutcome(outcome)).toBeNull()
			}
		})

		it('should name no box for an unknown code or none at all', () => {
			// GIVEN a code the page does not know and a call that never landed
			// WHEN each is placed
			// THEN neither belongs to a field
			expect(fieldForOutcome('something_new')).toBeNull()
			expect(fieldForOutcome(null)).toBeNull()
		})
	})
})
