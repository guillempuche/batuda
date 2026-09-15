import { describe, expect, it } from 'vitest'

import { narrowAttributes } from './attribute-shapes'

// A full row in the camelCased wire shape the API client hands back.
const row = {
	id: 'attr-1',
	organizationId: 'org-1',
	stackId: 'stack-1',
	stackName: 'Default',
	key: 'site_count',
	label: 'Sites',
	kind: 'number',
	enumValues: null,
	unit: 'sites',
	description: 'How many premises the company runs.',
	isActive: true,
	createdBy: 'user-1',
	createdAt: '2026-09-01T10:00:00.000Z',
	updatedAt: '2026-09-01T10:00:00.000Z',
}

describe('narrowAttributes [attribute-shapes.ts]', () => {
	describe('when the value is the listAttributes { items } wrapper', () => {
		it('should read every field a surface renders', () => {
			// GIVEN the envelope with one well-formed row
			// WHEN narrowed
			const [declaration] = narrowAttributes({ items: [row] })
			// THEN the row comes back typed, with its unit and description
			expect(declaration).toEqual({
				id: 'attr-1',
				stackId: 'stack-1',
				stackName: 'Default',
				key: 'site_count',
				label: 'Sites',
				kind: 'number',
				enumValues: [],
				unit: 'sites',
				description: 'How many premises the company runs.',
				isActive: true,
				createdAt: '2026-09-01T10:00:00.000Z',
			})
		})
	})

	describe('when the value is a bare array', () => {
		it('should narrow the rows in order', () => {
			// GIVEN two rows outside any envelope
			// WHEN narrowed
			const out = narrowAttributes([row, { ...row, id: 'attr-2', key: 'fit' }])
			// THEN both survive, in the order given
			expect(out.map(d => d.id)).toEqual(['attr-1', 'attr-2'])
		})
	})

	describe('when a row is a choice', () => {
		it('should keep only the string words', () => {
			// GIVEN a choice whose words carry a stray non-string
			const choice = {
				...row,
				kind: 'enum',
				enumValues: ['strong', 7, 'possible'],
			}
			// WHEN narrowed
			const [declaration] = narrowAttributes([choice])
			// THEN the words are the strings alone
			expect(declaration?.enumValues).toEqual(['strong', 'possible'])
		})
	})

	describe('when a row cannot be keyed, labelled or typed', () => {
		it('should drop a row missing its id, stack, key or label', () => {
			// GIVEN rows each lacking one of the fields every surface needs
			const rows = [
				{ ...row, id: undefined },
				{ ...row, stackId: 3 },
				{ ...row, key: null },
				{ ...row, label: undefined },
			]
			// WHEN narrowed
			// THEN none survive
			expect(narrowAttributes(rows)).toEqual([])
		})

		it('should drop a row whose kind the app does not know', () => {
			// GIVEN a kind written by hand into the table
			// WHEN narrowed
			// THEN the row is left out rather than shown as text
			expect(narrowAttributes([{ ...row, kind: 'money' }])).toEqual([])
		})
	})

	describe('when a row is retired or lacks the flag', () => {
		it('should read a missing or false flag as retired', () => {
			// GIVEN one retired row and one without the flag
			// WHEN narrowed
			const out = narrowAttributes([
				{ ...row, isActive: false },
				{ ...row, id: 'attr-2', isActive: undefined },
			])
			// THEN neither reads as active
			expect(out.map(d => d.isActive)).toEqual([false, false])
		})
	})

	describe('when the value is not a list at all', () => {
		it('should answer an empty list', () => {
			// GIVEN a string, a null and an envelope without items
			// WHEN narrowed
			// THEN nothing comes back and nothing throws
			expect(narrowAttributes('nope')).toEqual([])
			expect(narrowAttributes(null)).toEqual([])
			expect(narrowAttributes({ error: 'unknown_agent' })).toEqual([])
		})
	})
})
