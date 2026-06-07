import { describe, expect, it } from 'vitest'

import {
	assembleSegments,
	dedupeKeepFirst,
	personalTemplatesInOrgStack,
	pickStackSource,
} from './resolver'

describe('pickStackSource', () => {
	describe('when a per-run override is present', () => {
		it('should choose the override even when both defaults exist', () => {
			// GIVEN an override alongside a user and an org stack [resolver.ts:16]
			const source = pickStackSource({
				hasOverride: true,
				hasUserStack: true,
				hasOrgStack: true,
			})
			// THEN the override wins
			expect(source).toBe('override')
		})
	})

	describe('when there is no override but the user has their own stack', () => {
		it('should choose the user stack over the org default', () => {
			// GIVEN a user stack and an org default [resolver.ts:16]
			const source = pickStackSource({
				hasOverride: false,
				hasUserStack: true,
				hasOrgStack: true,
			})
			// THEN the user's own default replaces the org default
			expect(source).toBe('user')
		})
	})

	describe('when only the org default exists', () => {
		it('should fall back to the org stack', () => {
			// GIVEN only an org default [resolver.ts:16]
			const source = pickStackSource({
				hasOverride: false,
				hasUserStack: false,
				hasOrgStack: true,
			})
			// THEN the org stack is used
			expect(source).toBe('org')
		})
	})

	describe('when nothing applies', () => {
		it('should resolve to none so the run uses only the built-in prompt', () => {
			// GIVEN no override, no user stack, no org stack [resolver.ts:16]
			const source = pickStackSource({
				hasOverride: false,
				hasUserStack: false,
				hasOrgStack: false,
			})
			// THEN nothing is layered in
			expect(source).toBe('none')
		})
	})
})

describe('assembleSegments', () => {
	describe('when templates carry content', () => {
		it('should keep one trimmed segment per template in stack order', () => {
			// GIVEN two non-empty bodies with surrounding whitespace [resolver.ts:33]
			const segments = assembleSegments([
				{ body: '  sell to hotels  ' },
				{ body: 'be terse' },
			])
			// THEN they become trimmed, ordered segments
			expect(segments).toEqual(['sell to hotels', 'be terse'])
		})
	})

	describe('when a body is blank or whitespace-only', () => {
		it('should drop it so no empty segment reaches the prompt', () => {
			// GIVEN a mix of real and blank bodies [resolver.ts:33]
			const segments = assembleSegments([
				{ body: 'keep' },
				{ body: '   ' },
				{ body: '' },
			])
			// THEN only the real one survives
			expect(segments).toEqual(['keep'])
		})
	})

	describe('when there are no templates', () => {
		it('should return an empty list', () => {
			// GIVEN no templates [resolver.ts:33]
			// THEN there are no segments
			expect(assembleSegments([])).toEqual([])
		})
	})
})

describe('personalTemplatesInOrgStack', () => {
	describe('when an org stack references only org-owned templates', () => {
		it('should report no offenders', () => {
			// GIVEN an org stack of org-owned templates [resolver.ts:46]
			const offenders = personalTemplatesInOrgStack([
				{ templateId: 'a', ownerUserId: null },
				{ templateId: 'b', ownerUserId: null },
			])
			// THEN the stack is valid
			expect(offenders).toEqual([])
		})
	})

	describe('when an org stack references personal templates', () => {
		it('should flag the personal ids RLS would silently hide from other members', () => {
			// GIVEN an org stack mixing an org template with two members' personal
			// templates [resolver.ts:46]
			const offenders = personalTemplatesInOrgStack([
				{ templateId: 'org-1', ownerUserId: null },
				{ templateId: 'mine', ownerUserId: 'user_42' },
				{ templateId: 'theirs', ownerUserId: 'user_99' },
			])
			// THEN both personal templates are flagged, so the write is rejected
			expect(offenders).toEqual(['mine', 'theirs'])
		})
	})

	describe('when the stack is empty', () => {
		it('should report no offenders', () => {
			// GIVEN an empty org stack [resolver.ts:46]
			// THEN there is nothing to reject
			expect(personalTemplatesInOrgStack([])).toEqual([])
		})
	})
})

describe('dedupeKeepFirst', () => {
	describe('when an id repeats later in the list', () => {
		it('should keep the first occurrence and preserve order', () => {
			// GIVEN a list with a later duplicate [resolver.ts:dedupeKeepFirst]
			// THEN the first position is kept and the duplicate dropped
			expect(dedupeKeepFirst(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c'])
		})
	})

	describe('when a user addition repeats an org template (the extend case)', () => {
		it('should keep the template in its earlier org position', () => {
			// GIVEN the org default ids followed by the user's additions, one of
			// which is already in the org block [resolver.ts:dedupeKeepFirst]
			const orgIds = ['org-1', 'org-2']
			const userAdditions = ['org-2', 'mine']
			// THEN org-2 keeps its org position and the user's duplicate is dropped
			expect(dedupeKeepFirst([...orgIds, ...userAdditions])).toEqual([
				'org-1',
				'org-2',
				'mine',
			])
		})
	})

	describe('when there are no duplicates', () => {
		it('should return the ids unchanged', () => {
			// GIVEN all-distinct ids [resolver.ts:dedupeKeepFirst]
			expect(dedupeKeepFirst(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
		})
	})

	describe('when the list is empty', () => {
		it('should return an empty list', () => {
			// GIVEN no ids [resolver.ts:dedupeKeepFirst]
			expect(dedupeKeepFirst([])).toEqual([])
		})
	})
})
