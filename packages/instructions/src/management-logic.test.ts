import { describe, expect, it } from 'vitest'

import { classifyStackTemplates, decideTemplateEdit } from './management-logic'

describe('decideTemplateEdit', () => {
	describe('when the actor owns the template', () => {
		it('should edit it in place', () => {
			// GIVEN a personal template owned by the actor
			// WHEN the owner edits it
			// THEN it changes in place
			expect(decideTemplateEdit({ ownerUserId: 'u1', actorUserId: 'u1' })).toBe(
				'in_place',
			)
		})
	})

	describe('when the template belongs to the organization', () => {
		it('should edit it in place for anyone in the organization', () => {
			// GIVEN an org-owned template (no personal owner)
			// WHEN any member edits it — the shared guidance is everyone's to keep
			// THEN it changes in place, for everyone, whoever the member is
			expect(decideTemplateEdit({ ownerUserId: null, actorUserId: 'u1' })).toBe(
				'in_place',
			)
			expect(decideTemplateEdit({ ownerUserId: null, actorUserId: 'u2' })).toBe(
				'in_place',
			)
		})
	})

	describe("when the template is another member's personal template", () => {
		it('should deny the edit', () => {
			// GIVEN a personal template owned by somebody else
			// WHEN a different member tries to edit it
			// THEN it is denied — it is not theirs, and RLS hides it anyway
			expect(decideTemplateEdit({ ownerUserId: 'u2', actorUserId: 'u1' })).toBe(
				'deny',
			)
		})
	})
})

describe('classifyStackTemplates', () => {
	describe('when every requested template is readable', () => {
		it('should accept an org stack of org-owned templates', () => {
			// GIVEN an org stack referencing only org-owned templates [management-logic.ts:38]
			const result = classifyStackTemplates({
				requestedIds: ['a', 'b'],
				found: [
					{ id: 'a', ownerUserId: null },
					{ id: 'b', ownerUserId: null },
				],
				isOrgStack: true,
			})
			// THEN it is valid
			expect(result).toEqual({ kind: 'ok' })
		})

		it('should accept a personal stack that mixes personal and org templates', () => {
			// GIVEN a user's own stack referencing their personal + an org template [management-logic.ts:38]
			const result = classifyStackTemplates({
				requestedIds: ['mine', 'org'],
				found: [
					{ id: 'mine', ownerUserId: 'u1' },
					{ id: 'org', ownerUserId: null },
				],
				isOrgStack: false,
			})
			// THEN personal templates are allowed in a personal stack
			expect(result).toEqual({ kind: 'ok' })
		})

		it('should accept an empty stack', () => {
			// GIVEN no requested templates [management-logic.ts:38]
			// THEN there is nothing to reject
			expect(
				classifyStackTemplates({
					requestedIds: [],
					found: [],
					isOrgStack: true,
				}),
			).toEqual({ kind: 'ok' })
		})
	})

	describe('when a requested template is not readable', () => {
		it('should report the missing ids', () => {
			// GIVEN a requested id absent from the readable set (RLS-hidden or wrong) [management-logic.ts:38]
			const result = classifyStackTemplates({
				requestedIds: ['a', 'ghost'],
				found: [{ id: 'a', ownerUserId: null }],
				isOrgStack: false,
			})
			// THEN the unknown id is surfaced
			expect(result).toEqual({ kind: 'unknown', missing: ['ghost'] })
		})

		it('should report unknown before checking org ownership', () => {
			// GIVEN an org stack with both a missing id and a personal template [management-logic.ts:38]
			const result = classifyStackTemplates({
				requestedIds: ['ghost', 'personal'],
				found: [{ id: 'personal', ownerUserId: 'u1' }],
				isOrgStack: true,
			})
			// THEN the missing id is reported first (you can't validate ownership of
			// a template that didn't load)
			expect(result).toEqual({ kind: 'unknown', missing: ['ghost'] })
		})
	})

	describe('when an org stack references a personal template', () => {
		it('should flag the offending personal ids', () => {
			// GIVEN an org stack mixing an org template with two members' personal
			// templates [management-logic.ts:38]
			const result = classifyStackTemplates({
				requestedIds: ['org', 'mine', 'theirs'],
				found: [
					{ id: 'org', ownerUserId: null },
					{ id: 'mine', ownerUserId: 'u1' },
					{ id: 'theirs', ownerUserId: 'u2' },
				],
				isOrgStack: true,
			})
			// THEN both personal templates are rejected
			expect(result).toEqual({
				kind: 'personal_in_org',
				offending: ['mine', 'theirs'],
			})
		})
	})
})
