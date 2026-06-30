import { describe, expect, it } from 'vitest'

import {
	assembleSegments,
	classifyInstructionRefs,
	dedupeKeepFirst,
	isUuidRef,
	personalTemplatesInOrgStack,
	pickStackSource,
} from './resolver'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

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

describe('isUuidRef', () => {
	describe('when the ref is a UUID', () => {
		it('should treat it as an id regardless of case', () => {
			// GIVEN a canonical and an upper-case UUID [resolver.ts:isUuidRef]
			// THEN both read as ids
			expect(isUuidRef(UUID_A)).toBe(true)
			expect(isUuidRef(UUID_A.toUpperCase())).toBe(true)
		})
	})

	describe('when the ref is a human name', () => {
		it('should not mistake a name for an id', () => {
			// GIVEN a plain template name [resolver.ts:isUuidRef]
			// THEN it is not a UUID
			expect(isUuidRef('sell to hotels')).toBe(false)
			expect(isUuidRef('')).toBe(false)
		})
	})
})

describe('classifyInstructionRefs', () => {
	describe('when a ref is already a UUID', () => {
		it('should pass the id through without needing a name match', () => {
			// GIVEN a UUID ref and no matching rows [resolver.ts:classifyInstructionRefs]
			const result = classifyInstructionRefs({ refs: [UUID_A], found: [] })
			// THEN the id is taken at face value
			expect(result).toEqual({ ok: true, templateIds: [UUID_A] })
		})
	})

	describe('when a name matches exactly one readable template', () => {
		it('should resolve the name to that template id', () => {
			// GIVEN a single org template found by name [resolver.ts:classifyInstructionRefs]
			const result = classifyInstructionRefs({
				refs: ['be terse'],
				found: [{ id: UUID_A, name: 'be terse', ownerUserId: null }],
			})
			// THEN the name resolves to the id
			expect(result).toEqual({ ok: true, templateIds: [UUID_A] })
		})
	})

	describe('when ids and names are mixed', () => {
		it('should preserve the requested order so stack order is kept', () => {
			// GIVEN a name, then an id, then another name [resolver.ts:classifyInstructionRefs]
			const result = classifyInstructionRefs({
				refs: ['be terse', UUID_B, 'sell to hotels'],
				found: [
					{ id: UUID_A, name: 'be terse', ownerUserId: 'user_1' },
					{
						id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
						name: 'sell to hotels',
						ownerUserId: null,
					},
				],
			})
			// THEN ids come back in the order the caller asked for them
			expect(result).toEqual({
				ok: true,
				templateIds: [UUID_A, UUID_B, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
			})
		})
	})

	describe('when a name matches no readable template', () => {
		it('should report it as unknown so the caller can fix the typo', () => {
			// GIVEN a name with no matching row [resolver.ts:classifyInstructionRefs]
			const result = classifyInstructionRefs({ refs: ['nope'], found: [] })
			// THEN the run is blocked and the unmatched name is surfaced
			expect(result).toEqual({ ok: false, unknown: ['nope'], ambiguous: [] })
		})
	})

	describe('when a name matches both a personal and an org template', () => {
		it('should report the candidates with their scope so the AI can re-ask by id', () => {
			// GIVEN one name shared by an org and a personal template
			// [resolver.ts:classifyInstructionRefs]
			const result = classifyInstructionRefs({
				refs: ['tone'],
				found: [
					{ id: UUID_A, name: 'tone', ownerUserId: null },
					{ id: UUID_B, name: 'tone', ownerUserId: 'user_1' },
				],
			})
			// THEN the collision is flagged with both candidates and their scope
			expect(result).toEqual({
				ok: false,
				unknown: [],
				ambiguous: [
					{
						query: 'tone',
						candidates: [
							{ id: UUID_A, name: 'tone', scope: 'org' },
							{ id: UUID_B, name: 'tone', scope: 'personal' },
						],
					},
				],
			})
		})
	})

	describe('when some refs are unknown and others ambiguous', () => {
		it('should collect both failures in one response', () => {
			// GIVEN an unknown name and an ambiguous name together
			// [resolver.ts:classifyInstructionRefs]
			const result = classifyInstructionRefs({
				refs: ['ghost', 'tone'],
				found: [
					{ id: UUID_A, name: 'tone', ownerUserId: null },
					{ id: UUID_B, name: 'tone', ownerUserId: 'user_1' },
				],
			})
			// THEN both reasons come back so the caller fixes everything at once
			expect(result.ok).toBe(false)
			if (!result.ok) {
				expect(result.unknown).toEqual(['ghost'])
				expect(result.ambiguous.map(a => a.query)).toEqual(['tone'])
			}
		})
	})

	describe('when no refs are given', () => {
		it('should resolve to an empty id list', () => {
			// GIVEN no refs [resolver.ts:classifyInstructionRefs]
			// THEN there is nothing to override with
			expect(classifyInstructionRefs({ refs: [], found: [] })).toEqual({
				ok: true,
				templateIds: [],
			})
		})
	})

	describe('when the same template is referenced twice', () => {
		it('should collapse a repeated name to a single id', () => {
			// GIVEN one name listed twice [resolver.ts:classifyInstructionRefs]
			const result = classifyInstructionRefs({
				refs: ['be terse', 'be terse'],
				found: [{ id: UUID_A, name: 'be terse', ownerUserId: null }],
			})
			// THEN the template appears once, so the prompt isn't doubled
			expect(result).toEqual({ ok: true, templateIds: [UUID_A] })
		})

		it('should collapse a name listed alongside its own id', () => {
			// GIVEN the same template referenced by name then by id
			// [resolver.ts:classifyInstructionRefs]
			const result = classifyInstructionRefs({
				refs: ['be terse', UUID_A],
				found: [{ id: UUID_A, name: 'be terse', ownerUserId: null }],
			})
			// THEN both refs resolve to one id, kept in first position
			expect(result).toEqual({ ok: true, templateIds: [UUID_A] })
		})
	})
})
