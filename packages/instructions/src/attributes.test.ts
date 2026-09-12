import { describe, expect, it } from 'vitest'

import {
	type DeclarationContext,
	type DeclarationInput,
	type DeclaredAttribute,
	declaredByKey,
	sameShape,
	toDeclaration,
	validateAttributeFilter,
	validateAttributeWrite,
	validateDeclaration,
	validateKey,
} from './attributes'
import type { ResearchAttribute } from './domain'

// An org research stack with room to spare and no twin elsewhere.
const openStack: DeclarationContext = {
	stackAgent: 'research',
	stackOwnerUserId: null,
	activeOnStack: 0,
	sameKeyElsewhere: [],
}

const number: DeclarationInput = {
	key: 'site_count',
	label: 'Sites',
	kind: 'number',
	enumValues: null,
	unit: 'sites',
	description: 'How many premises the business trades from.',
	isActive: true,
}

const declared = (
	...attributes: ReadonlyArray<DeclaredAttribute>
): ReadonlyMap<string, DeclaredAttribute> =>
	new Map(attributes.map(attribute => [attribute.key, attribute]))

const SITES: DeclaredAttribute = {
	key: 'site_count',
	kind: 'number',
	enumValues: null,
	unit: 'sites',
}
const FIT: DeclaredAttribute = {
	key: 'fit',
	kind: 'enum',
	enumValues: ['Molt gran', 'Petit'],
	unit: null,
}
const BOOKINGS: DeclaredAttribute = {
	key: 'takes_bookings',
	kind: 'boolean',
	enumValues: null,
	unit: null,
}
const FOUNDED: DeclaredAttribute = {
	key: 'founded_on',
	kind: 'date',
	enumValues: null,
	unit: null,
}
const TOOLS: DeclaredAttribute = {
	key: 'current_tools',
	kind: 'text',
	enumValues: null,
	unit: null,
}

describe('validateDeclaration', () => {
	describe('when the stack cannot carry attributes', () => {
		it('should refuse a personal stack before looking at anything else', () => {
			// GIVEN a personal stack, a bad key and the wrong agent all at once
			// THEN the first guard is the answer
			const check = validateDeclaration(
				{ ...number, key: '!' },
				{ ...openStack, stackOwnerUserId: 'u1', stackAgent: 'email' },
			)
			expect(check).toEqual({ ok: false, reason: 'stack_not_org' })
		})

		it('should refuse an org stack of another agent', () => {
			// GIVEN the org's email stack
			// THEN attributes are for research stacks only
			expect(
				validateDeclaration(number, { ...openStack, stackAgent: 'email' }),
			).toEqual({ ok: false, reason: 'agent_not_research' })
		})
	})

	describe('when the key is stored', () => {
		it('should trim it, and leave judging its shape to the create step', () => {
			// GIVEN a key with spaces around it, and a key that is reserved
			// THEN both pass here and are stored trimmed — the key is judged once,
			// when the declaration is created, so a name reserved later never
			// locks an existing declaration
			const check = validateDeclaration(
				{ ...number, key: '  site_count  ' },
				openStack,
			)
			expect(check.ok && check.declaration.key).toBe('site_count')
			expect(
				validateDeclaration({ ...number, key: 'industry' }, openStack).ok,
			).toBe(true)
		})
	})

	describe('when the label is wrong', () => {
		it('should require a label with something in it', () => {
			// GIVEN a blank label
			// THEN it is required
			expect(
				validateDeclaration({ ...number, label: '   ' }, openStack),
			).toEqual({ ok: false, reason: 'label_required' })
		})

		it('should accept forty characters and refuse forty-one, after trimming', () => {
			// GIVEN labels at the boundary
			// THEN the trim runs before the count
			expect(
				validateDeclaration({ ...number, label: 'a'.repeat(40) }, openStack).ok,
			).toBe(true)
			expect(
				validateDeclaration(
					{ ...number, label: `  ${'a'.repeat(40)}  ` },
					openStack,
				).ok,
			).toBe(true)
			expect(
				validateDeclaration({ ...number, label: 'a'.repeat(41) }, openStack),
			).toEqual({ ok: false, reason: 'label_too_long' })
		})

		it('should refuse a label that runs over two lines', () => {
			// GIVEN a short label with a line break in it
			// THEN it is refused for the break, not the length
			expect(
				validateDeclaration({ ...number, label: 'sites\nper town' }, openStack),
			).toEqual({ ok: false, reason: 'label_not_one_line' })
		})
	})

	describe('when the kind is unknown', () => {
		it('should refuse it before the enum and size rules run', () => {
			// GIVEN a kind nobody declared, spelt with a capital too
			// THEN the kind is the answer
			expect(
				validateDeclaration(
					{ ...number, kind: 'integer', unit: 'x'.repeat(30) },
					openStack,
				),
			).toEqual({ ok: false, reason: 'unknown_kind' })
			expect(
				validateDeclaration({ ...number, kind: 'Number' }, openStack),
			).toEqual({ ok: false, reason: 'unknown_kind' })
		})
	})

	describe('when the kind is a choice', () => {
		const choice: DeclarationInput = {
			...number,
			key: 'fit',
			kind: 'enum',
			unit: null,
			enumValues: ['Gran', 'Petit'],
		}

		it('should require the words to choose from', () => {
			// GIVEN no words, and an empty list
			// THEN both are refused
			expect(
				validateDeclaration({ ...choice, enumValues: null }, openStack),
			).toEqual({ ok: false, reason: 'enum_values_required' })
			expect(
				validateDeclaration({ ...choice, enumValues: [] }, openStack),
			).toEqual({ ok: false, reason: 'enum_values_required' })
		})

		it('should refuse a blank word, a word that folds to nothing, and two words that fold the same', () => {
			// GIVEN word lists with one bad entry each
			// THEN each is refused
			for (const enumValues of [
				['Gran', ''],
				['Gran', '   '],
				['Gran', '---'],
				['Gran', 'grán'],
				['Molt gran', 'molt-gran'],
			])
				expect(
					validateDeclaration({ ...choice, enumValues }, openStack),
				).toEqual({ ok: false, reason: 'enum_value_invalid' })
		})

		it('should accept a word of thirty-two characters and refuse thirty-three, after trimming', () => {
			// GIVEN words at the boundary
			// THEN the trim runs before the count
			expect(
				validateDeclaration(
					{ ...choice, enumValues: ['a'.repeat(32)] },
					openStack,
				).ok,
			).toBe(true)
			expect(
				validateDeclaration(
					{ ...choice, enumValues: [`  ${'a'.repeat(32)}  `] },
					openStack,
				).ok,
			).toBe(true)
			expect(
				validateDeclaration(
					{ ...choice, enumValues: ['a'.repeat(33)] },
					openStack,
				),
			).toEqual({ ok: false, reason: 'enum_value_invalid' })
		})

		it('should store the trimmed words in the order they were given', () => {
			// GIVEN words with spaces around them
			// THEN they keep their order and lose the spaces
			const check = validateDeclaration(
				{ ...choice, enumValues: [' Petit ', 'Gran'] },
				openStack,
			)
			expect(check.ok && check.declaration.enumValues).toEqual([
				'Petit',
				'Gran',
			])
		})
	})

	describe('when the kind is not a choice', () => {
		it('should refuse words sent anyway, but let an empty list through as none', () => {
			// GIVEN a number with words, and one with an empty list
			// THEN words are refused and the empty list stores as null
			expect(
				validateDeclaration({ ...number, enumValues: ['a'] }, openStack),
			).toEqual({ ok: false, reason: 'enum_values_not_allowed' })
			const check = validateDeclaration(
				{ ...number, enumValues: [] },
				openStack,
			)
			expect(check.ok && check.declaration.enumValues).toBeNull()
		})
	})

	describe('when the unit or description is wrong', () => {
		it('should store a blank unit or description as none', () => {
			// GIVEN whitespace in both
			// THEN both become null
			const check = validateDeclaration(
				{ ...number, unit: '   ', description: '\n' },
				openStack,
			)
			expect(check.ok && check.declaration.unit).toBeNull()
			expect(check.ok && check.declaration.description).toBeNull()
		})

		it('should accept the caps exactly and refuse one more', () => {
			// GIVEN a unit and a description at their boundaries
			// THEN sixteen and five hundred pass, one more does not
			expect(
				validateDeclaration({ ...number, unit: 'u'.repeat(16) }, openStack).ok,
			).toBe(true)
			expect(
				validateDeclaration({ ...number, unit: 'u'.repeat(17) }, openStack),
			).toEqual({ ok: false, reason: 'unit_too_long' })
			expect(
				validateDeclaration(
					{ ...number, description: 'd'.repeat(500) },
					openStack,
				).ok,
			).toBe(true)
			expect(
				validateDeclaration(
					{ ...number, description: 'd'.repeat(501) },
					openStack,
				),
			).toEqual({ ok: false, reason: 'description_too_long' })
		})

		it('should allow a description over several lines', () => {
			// GIVEN a multi-line description
			// THEN only the label has to be one line
			expect(
				validateDeclaration({ ...number, description: 'one\ntwo' }, openStack)
					.ok,
			).toBe(true)
		})
	})

	describe('when another stack of the organisation declares the key', () => {
		it('should accept a twin that reads the value the same way, whatever the word order or case', () => {
			// GIVEN a choice declared elsewhere with the same words in another order and case
			// THEN the two agree
			const check = validateDeclaration(
				{
					...number,
					key: 'fit',
					kind: 'enum',
					unit: null,
					enumValues: ['Gran', 'Petit'],
				},
				{
					...openStack,
					sameKeyElsewhere: [
						{ kind: 'enum', enumValues: ['petit', 'GRAN'], unit: null },
					],
				},
			)
			expect(check.ok).toBe(true)
		})

		it('should refuse a twin of another kind, unit or word set, even when only one twin disagrees', () => {
			// GIVEN twins that read the value differently
			// THEN each is a mismatch
			const mismatches: ReadonlyArray<DeclarationContext['sameKeyElsewhere']> =
				[
					[{ kind: 'text', enumValues: null, unit: null }],
					[{ kind: 'number', enumValues: null, unit: 'towns' }],
					[
						{ kind: 'number', enumValues: null, unit: 'sites' },
						{ kind: 'number', enumValues: null, unit: null },
					],
				]
			for (const sameKeyElsewhere of mismatches)
				expect(
					validateDeclaration(number, { ...openStack, sameKeyElsewhere }),
				).toEqual({ ok: false, reason: 'kind_mismatch' })
		})
	})

	describe('when a retired declaration of the key still pins its shape', () => {
		it('should refuse a different shape on a new stack, since values were written the old way', () => {
			// GIVEN a retired text declaration elsewhere, handed in like any twin
			// THEN a number declaration is a mismatch
			expect(
				validateDeclaration(number, {
					...openStack,
					sameKeyElsewhere: [{ kind: 'text', enumValues: null, unit: null }],
				}),
			).toEqual({ ok: false, reason: 'kind_mismatch' })
		})
	})

	describe('when the stack is full', () => {
		it('should accept the eighth active declaration and refuse the ninth', () => {
			// GIVEN seven, then eight, already active
			// THEN eight is the cap
			expect(
				validateDeclaration(number, { ...openStack, activeOnStack: 7 }).ok,
			).toBe(true)
			expect(
				validateDeclaration(number, { ...openStack, activeOnStack: 8 }),
			).toEqual({ ok: false, reason: 'too_many_active' })
		})

		it('should let a retired declaration through a full stack', () => {
			// GIVEN eight active and a declaration being retired
			// THEN the cap does not apply
			expect(
				validateDeclaration(
					{ ...number, isActive: false },
					{ ...openStack, activeOnStack: 8 },
				).ok,
			).toBe(true)
		})

		it('should report a mismatching twin before the cap', () => {
			// GIVEN a full stack and a twin of another kind
			// THEN the twin is the answer
			expect(
				validateDeclaration(number, {
					...openStack,
					activeOnStack: 8,
					sameKeyElsewhere: [{ kind: 'text', enumValues: null, unit: null }],
				}),
			).toEqual({ ok: false, reason: 'kind_mismatch' })
		})
	})

	describe('when everything passes', () => {
		it('should return the cleaned declaration with isActive carried through', () => {
			// GIVEN padded fields and a retired flag
			// THEN every text is trimmed and nothing else is added
			const check = validateDeclaration(
				{
					...number,
					key: ' site_count ',
					label: ' Sites ',
					unit: ' sites ',
					description: ' How many. ',
					isActive: false,
				},
				openStack,
			)
			expect(check).toEqual({
				ok: true,
				declaration: {
					key: 'site_count',
					label: 'Sites',
					kind: 'number',
					enumValues: null,
					unit: 'sites',
					description: 'How many.',
					isActive: false,
				},
			})
		})
	})
})

describe('validateKey', () => {
	describe('when the key is judged for a new declaration', () => {
		it('should call a badly shaped key invalid, a reserved one reserved, and trim first', () => {
			// GIVEN a key with a capital, a prototype name, keys the run already
			// uses, and a good key with spaces around it
			// THEN the shape rule runs first, the reserved rule second
			expect(validateKey('Site')).toBe('invalid_key')
			expect(validateKey('__proto__')).toBe('invalid_key')
			for (const key of ['industry', 'value', 'constructor'])
				expect(validateKey(key)).toBe('reserved_key')
			expect(validateKey('  site_count  ')).toBeNull()
		})
	})
})

describe('sameShape', () => {
	describe('when two declarations read a value the same way', () => {
		it('should treat words as equal across order, case and accents, and no words as an empty list', () => {
			// GIVEN the same choice words written differently, and null against []
			// THEN both pairs are the same shape
			expect(
				sameShape(
					{ kind: 'enum', enumValues: ['Gran', 'Petit'], unit: null },
					{ kind: 'enum', enumValues: ['petit', 'grán'], unit: null },
				),
			).toBe(true)
			expect(
				sameShape(
					{ kind: 'text', enumValues: null, unit: null },
					{ kind: 'text', enumValues: [], unit: null },
				),
			).toBe(true)
		})
	})

	describe('when they differ', () => {
		it('should tell apart a kind, a unit written in another case, a word set, and a word split in two', () => {
			// GIVEN pairs differing in one thing each
			// THEN none is the same shape
			expect(
				sameShape(
					{ kind: 'number', enumValues: null, unit: null },
					{ kind: 'text', enumValues: null, unit: null },
				),
			).toBe(false)
			expect(
				sameShape(
					{ kind: 'number', enumValues: null, unit: 'kg' },
					{ kind: 'number', enumValues: null, unit: 'Kg' },
				),
			).toBe(false)
			expect(
				sameShape(
					{ kind: 'enum', enumValues: ['a', 'b'], unit: null },
					{ kind: 'enum', enumValues: ['a', 'b', 'c'], unit: null },
				),
			).toBe(false)
			expect(
				sameShape(
					{ kind: 'enum', enumValues: ['a b'], unit: null },
					{ kind: 'enum', enumValues: ['a', 'b'], unit: null },
				),
			).toBe(false)
		})
	})
})

describe('validateAttributeWrite', () => {
	describe('when nothing is written', () => {
		it('should return an empty plan', () => {
			// GIVEN an empty bag
			// THEN nothing to set and nothing to remove
			expect(validateAttributeWrite(declared(SITES), {})).toEqual({
				ok: true,
				plan: { values: {}, removed: [] },
			})
		})
	})

	describe('when a key is set to null', () => {
		it('should remove it without consulting the declarations', () => {
			// GIVEN a null under a key nobody declares any more
			// THEN it is removed, beside a value that is set
			expect(
				validateAttributeWrite(declared(SITES), {
					retired_key: null,
					site_count: 2,
				}),
			).toEqual({
				ok: true,
				plan: {
					values: { site_count: { value: 2 } },
					removed: ['retired_key'],
				},
			})
		})
	})

	describe('when a key is not declared', () => {
		it('should refuse and name the first offending key', () => {
			// GIVEN two undeclared keys
			// THEN the first in order is named
			expect(
				validateAttributeWrite(declared(), { loads: 3, quotes: 4 }),
			).toEqual({ ok: false, reason: 'undeclared_key', key: 'loads' })
		})

		it('should not find a key through the prototype of the map', () => {
			// GIVEN a key that every object inherits
			// THEN it is undeclared, not a function
			expect(
				validateAttributeWrite(declared(SITES), { tostring: 'x' }),
			).toEqual({ ok: false, reason: 'undeclared_key', key: 'tostring' })
		})
	})

	describe('when a value does not read as the kind', () => {
		it('should refuse the whole bag on the first bad key, bare or wrapped', () => {
			// GIVEN a good key followed by a bad one, and a bad one wrapped
			// THEN the refusal names the bad key and keeps no partial plan
			expect(
				validateAttributeWrite(declared(SITES, TOOLS), {
					current_tools: 'Excel',
					site_count: 'many',
				}),
			).toEqual({ ok: false, reason: 'wrong_kind', key: 'site_count' })
			expect(
				validateAttributeWrite(declared(SITES), {
					site_count: { value: 'many' },
				}),
			).toEqual({ ok: false, reason: 'wrong_kind', key: 'site_count' })
		})
	})

	describe('when the value is bare', () => {
		it('should store the value read as its kind with no notes', () => {
			// GIVEN a number as text, a choice in capitals and a yes
			// THEN each is stored canonical, with only a value
			const check = validateAttributeWrite(declared(SITES, FIT, BOOKINGS), {
				site_count: ' 12 ',
				fit: 'MOLT GRAN',
				takes_bookings: 'yes',
			})
			expect(check).toEqual({
				ok: true,
				plan: {
					values: {
						site_count: { value: 12 },
						fit: { value: 'Molt gran' },
						takes_bookings: { value: true },
					},
					removed: [],
				},
			})
		})
	})

	describe('when the value is wrapped', () => {
		it('should keep trimmed notes and drop blank ones', () => {
			// GIVEN a page with spaces, a blank quote and an empty date
			// THEN only the page survives
			const check = validateAttributeWrite(declared(TOOLS), {
				current_tools: {
					value: 'Excel',
					source_id: '  https://a.example/x  ',
					quote: '   ',
					as_of: '',
				},
			})
			expect(check).toEqual({
				ok: true,
				plan: {
					values: {
						current_tools: { value: 'Excel', source_id: 'https://a.example/x' },
					},
					removed: [],
				},
			})
		})

		it('should cut an over-long quote and drop a page name longer than any address', () => {
			// GIVEN a quote past the cap and a page name past the address cap
			const check = validateAttributeWrite(declared(TOOLS), {
				current_tools: {
					value: 'Excel',
					quote: 'q'.repeat(600),
					source_id: `https://a.example/${'x'.repeat(2100)}`,
				},
			})
			// THEN the quote is kept to the cap and the page name is gone
			expect(check.ok && check.plan.values['current_tools']).toEqual({
				value: 'Excel',
				quote: 'q'.repeat(500),
			})
		})

		it('should keep a date note only when it names a real day', () => {
			// GIVEN a date note that is not a day, and one that is
			// THEN the first is dropped and the second kept
			const loose = validateAttributeWrite(declared(TOOLS), {
				current_tools: { value: 'Excel', as_of: 'whenever' },
			})
			expect(loose.ok && loose.plan.values['current_tools']).toEqual({
				value: 'Excel',
			})
			const day = validateAttributeWrite(declared(TOOLS), {
				current_tools: { value: 'Excel', as_of: '2024-02-29' },
			})
			expect(day.ok && day.plan.values['current_tools']).toEqual({
				value: 'Excel',
				as_of: '2024-02-29',
			})
		})
	})

	describe('when a key could reach the prototype', () => {
		it('should build a plain own property rather than poisoning the object', () => {
			// GIVEN a bag built by hand around the door's key check
			// THEN the plan holds an own property and no object is changed
			const bag = JSON.parse('{"__proto__": "x"}') as Record<string, string>
			const check = validateAttributeWrite(
				declared({ ...TOOLS, key: '__proto__' }),
				bag,
			)
			expect(check.ok && Object.hasOwn(check.plan.values, '__proto__')).toBe(
				true,
			)
			expect({} as { polluted?: unknown }).not.toHaveProperty('polluted')
		})
	})
})

describe('validateAttributeFilter', () => {
	const all = declared(SITES, FIT, BOOKINGS, FOUNDED, TOOLS)

	describe('when the parts are missing', () => {
		it('should read no parts as no filter, and one or two parts as incomplete', () => {
			// GIVEN nothing, then each way of giving only some of the three
			// THEN nothing means no filter and anything less than three is incomplete
			expect(validateAttributeFilter(all, {})).toEqual({
				ok: true,
				filter: undefined,
			})
			for (const parts of [
				{ key: 'site_count' },
				{ key: 'site_count', op: 'eq' },
				{ op: 'eq', value: '1' },
				{ value: '1' },
			])
				expect(validateAttributeFilter(all, parts)).toEqual({
					ok: false,
					reason: 'filter_incomplete',
				})
		})

		it('should treat an empty part as given', () => {
			// GIVEN three empty strings
			// THEN they are complete and fall on the operator
			expect(
				validateAttributeFilter(all, { key: '', op: '', value: '' }),
			).toEqual({ ok: false, reason: 'unknown_operator' })
		})
	})

	describe('when the operator is unknown', () => {
		it('should refuse before looking the key up, and never trim or fold the operator', () => {
			// GIVEN an operator that does not exist on an undeclared key, and known ones misspelt
			// THEN the operator is the answer every time
			expect(
				validateAttributeFilter(all, { key: 'gone', op: 'like', value: 'x' }),
			).toEqual({ ok: false, reason: 'unknown_operator' })
			for (const op of [' eq ', 'EQ', 'IN'])
				expect(
					validateAttributeFilter(all, { key: 'site_count', op, value: '1' }),
				).toEqual({ ok: false, reason: 'unknown_operator' })
		})
	})

	describe('when the key is not declared', () => {
		it('should pass it through as undeclared, trimmed, without judging the operator against a kind', () => {
			// GIVEN a key nobody declares with an operator no kind would take here
			// THEN the filter says undeclared rather than refusing
			expect(
				validateAttributeFilter(all, {
					key: '  gone  ',
					op: 'contains',
					value: 'x',
				}),
			).toEqual({ ok: true, filter: { key: 'gone', undeclared: true } })
		})
	})

	describe('when the operator does not fit the kind', () => {
		it('should refuse ranges on text, choices and yes/no, lists on numbers and dates, and contains anywhere but text', () => {
			// GIVEN each operator on a kind that does not take it
			// THEN each is refused
			const refused: ReadonlyArray<[string, string]> = [
				['current_tools', 'gte'],
				['fit', 'lte'],
				['takes_bookings', 'gte'],
				['site_count', 'in'],
				['founded_on', 'in'],
				['fit', 'contains'],
				['takes_bookings', 'contains'],
				['site_count', 'contains'],
				['founded_on', 'contains'],
			]
			for (const [key, op] of refused)
				expect(validateAttributeFilter(all, { key, op, value: '1' })).toEqual({
					ok: false,
					reason: 'operator_not_for_kind',
				})
		})
	})

	describe('when the value does not read as the kind', () => {
		it('should refuse a value of the wrong kind, an impossible day, and an empty value', () => {
			// GIVEN values that do not read as their kind
			// THEN each is refused
			expect(
				validateAttributeFilter(all, {
					key: 'site_count',
					op: 'gte',
					value: 'many',
				}),
			).toEqual({ ok: false, reason: 'value_not_for_kind' })
			expect(
				validateAttributeFilter(all, {
					key: 'founded_on',
					op: 'gte',
					value: '2024-02-30',
				}),
			).toEqual({ ok: false, reason: 'value_not_for_kind' })
			for (const key of [
				'current_tools',
				'site_count',
				'takes_bookings',
				'founded_on',
				'fit',
			])
				expect(
					validateAttributeFilter(all, { key, op: 'eq', value: '' }),
				).toEqual({ ok: false, reason: 'value_not_for_kind' })
		})

		it('should keep the value read as its kind', () => {
			// GIVEN a choice in lowercase, a number with spaces and a yes
			// THEN each is canonical in the filter
			expect(
				validateAttributeFilter(all, {
					key: 'fit',
					op: 'eq',
					value: 'molt gran',
				}),
			).toEqual({
				ok: true,
				filter: { key: 'fit', kind: 'enum', op: 'eq', values: ['Molt gran'] },
			})
			expect(
				validateAttributeFilter(all, {
					key: 'site_count',
					op: 'gte',
					value: ' 12 ',
				}),
			).toEqual({
				ok: true,
				filter: { key: 'site_count', kind: 'number', op: 'gte', values: [12] },
			})
			expect(
				validateAttributeFilter(all, {
					key: 'takes_bookings',
					op: 'eq',
					value: 'YES',
				}),
			).toEqual({
				ok: true,
				filter: {
					key: 'takes_bookings',
					kind: 'boolean',
					op: 'eq',
					values: [true],
				},
			})
		})
	})

	describe('when the operator is a list', () => {
		it('should split on commas, trim, drop blanks, and keep the rest in order', () => {
			// GIVEN a list with spaces, a double comma and a trailing comma
			// THEN three clean values remain
			expect(
				validateAttributeFilter(all, {
					key: 'current_tools',
					op: 'in',
					value: ' a , b ,,c, ',
				}),
			).toEqual({
				ok: true,
				filter: {
					key: 'current_tools',
					kind: 'text',
					op: 'in',
					values: ['a', 'b', 'c'],
				},
			})
		})

		it('should refuse a list with nothing left, or one bad entry', () => {
			// GIVEN only commas, and a choice list with a word nobody declared
			// THEN both are refused whole
			expect(
				validateAttributeFilter(all, {
					key: 'current_tools',
					op: 'in',
					value: ',,,',
				}),
			).toEqual({ ok: false, reason: 'value_not_for_kind' })
			expect(
				validateAttributeFilter(all, {
					key: 'fit',
					op: 'in',
					value: 'Petit,nope',
				}),
			).toEqual({ ok: false, reason: 'value_not_for_kind' })
		})

		it('should not split on commas for any other operator', () => {
			// GIVEN a comma inside a contains value
			// THEN it is one value
			expect(
				validateAttributeFilter(all, {
					key: 'current_tools',
					op: 'contains',
					value: 'a,b',
				}),
			).toEqual({
				ok: true,
				filter: {
					key: 'current_tools',
					kind: 'text',
					op: 'contains',
					values: ['a,b'],
				},
			})
		})
	})
})

describe('declaredByKey', () => {
	const row = (overrides: Partial<ResearchAttribute>): ResearchAttribute => ({
		id: 'id',
		organizationId: 'org',
		stackId: 'stack',
		stackName: 'default',
		key: 'site_count',
		label: 'Sites',
		kind: 'number',
		enumValues: null,
		unit: 'sites',
		description: null,
		isActive: true,
		createdBy: 'u1',
		createdAt: '1',
		updatedAt: '1',
		...overrides,
	})

	describe('when several stacks declare the same key', () => {
		it('should keep the first row per key and only what a value check needs', () => {
			// GIVEN two rows under one key from two stacks
			// THEN the first wins, projected to its shape
			const map = declaredByKey([
				row({ stackName: 'a', unit: 'sites' }),
				row({ stackName: 'b', unit: 'towns' }),
			])
			expect(map.size).toBe(1)
			expect(map.get('site_count')).toEqual({
				key: 'site_count',
				kind: 'number',
				enumValues: null,
				unit: 'sites',
			})
		})
	})

	describe('when a row is retired', () => {
		it('should still include it, since the query is what filters', () => {
			// GIVEN a retired row
			// THEN it is in the map; callers pass the active list
			expect(declaredByKey([row({ isActive: false })]).has('site_count')).toBe(
				true,
			)
		})
	})

	describe('toDeclaration', () => {
		it('should hand a run only the six prompt-facing fields, nulls kept', () => {
			// GIVEN a full row
			// THEN nothing internal reaches a prompt
			expect(toDeclaration(row({}))).toEqual({
				key: 'site_count',
				label: 'Sites',
				kind: 'number',
				enumValues: null,
				unit: 'sites',
				description: null,
			})
		})
	})
})
