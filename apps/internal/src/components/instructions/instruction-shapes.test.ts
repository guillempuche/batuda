import { describe, expect, it } from 'vitest'

import { narrowStacks } from './instruction-shapes'

// A full org row and a full personal row, in the camelCased wire shape the API
// client hands back (there is no `scope` field — ownership drives it).
const orgRow = {
	id: 'stack-org',
	organizationId: 'org-1',
	ownerUserId: null,
	agent: 'research',
	name: 'Org baseline',
	isDefault: true,
	composition: 'replace',
	templateIds: ['t1', 't2'],
}
const personalRow = {
	id: 'stack-mine',
	organizationId: 'org-1',
	ownerUserId: 'user-1',
	agent: 'research',
	name: 'My picks',
	isDefault: false,
	composition: 'extend',
	templateIds: ['t3'],
}

describe('narrowStacks [instruction-shapes.ts]', () => {
	describe('when the value is a bare array of rows', () => {
		it('should narrow every row it can key on', () => {
			// GIVEN getStack-style bare array of two well-formed rows
			// WHEN narrowed
			const stacks = narrowStacks([orgRow, personalRow])
			// THEN both survive with their ids preserved in order
			expect(stacks.map(s => s.id)).toEqual(['stack-org', 'stack-mine'])
		})
	})

	describe('when the value is a listStacks { items } wrapper', () => {
		it('should read the items array', () => {
			// GIVEN the listStacks envelope shape
			// WHEN narrowed
			const stacks = narrowStacks({ items: [orgRow] })
			// THEN the wrapped row is returned
			expect(stacks).toHaveLength(1)
			expect(stacks[0]?.id).toBe('stack-org')
		})
	})

	describe('when a row is missing its id or name', () => {
		it('should skip that row', () => {
			// GIVEN one valid row and two rows missing a keyed field
			const rows = [
				orgRow,
				{ ...orgRow, id: undefined },
				{ ...orgRow, name: 42 },
			]
			// WHEN narrowed
			const stacks = narrowStacks(rows)
			// THEN only the valid row survives
			expect(stacks).toHaveLength(1)
			expect(stacks[0]?.id).toBe('stack-org')
		})
	})

	describe('when deriving scope from ownership', () => {
		it('should mark a null-owner row as org and an owned row as personal', () => {
			// GIVEN one org-owned and one member-owned row
			// WHEN narrowed
			const stacks = narrowStacks([orgRow, personalRow])
			// THEN scope follows ownerUserId
			expect(stacks[0]?.scope).toBe('org')
			expect(stacks[1]?.scope).toBe('personal')
		})
	})

	describe('when composition and the default flag are absent', () => {
		it('should default to replace and not-default with an empty template list', () => {
			// GIVEN a row carrying only id and name
			// WHEN narrowed
			const stacks = narrowStacks([{ id: 'bare', name: 'Bare' }])
			// THEN the safe defaults apply
			expect(stacks[0]).toMatchObject({
				composition: 'replace',
				isDefault: false,
				templateIds: [],
			})
		})
	})

	describe('when composition is the extend literal', () => {
		it('should carry extend through', () => {
			// GIVEN a personal row stored as extend
			// WHEN narrowed
			const stacks = narrowStacks([personalRow])
			// THEN the composition is preserved
			expect(stacks[0]?.composition).toBe('extend')
		})
	})

	describe('when the value is neither an array nor an items wrapper', () => {
		it('should return an empty list', () => {
			// GIVEN unrelated JSON (an error body, null)
			// WHEN narrowed
			// THEN nothing is produced
			expect(narrowStacks({ error: 'not_found' })).toEqual([])
			expect(narrowStacks(null)).toEqual([])
		})
	})
})
