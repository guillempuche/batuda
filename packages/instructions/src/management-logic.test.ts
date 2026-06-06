import { describe, expect, it } from 'vitest'

import { classifyStackTemplates, decideTemplateEdit } from './management-logic'

describe('decideTemplateEdit', () => {
	describe('when the actor owns the template', () => {
		it('should edit in place, regardless of admin role', () => {
			// GIVEN a personal template owned by the actor [management-logic.ts:13]
			// THEN a non-admin owner edits their own template in place
			expect(
				decideTemplateEdit({
					ownerUserId: 'u1',
					actorUserId: 'u1',
					actorIsAdmin: false,
				}),
			).toBe('in_place')
			// AND an admin owner is the same — ownership decides, not the role
			expect(
				decideTemplateEdit({
					ownerUserId: 'u1',
					actorUserId: 'u1',
					actorIsAdmin: true,
				}),
			).toBe('in_place')
		})
	})

	describe('when the template is org-owned', () => {
		it('should edit in place for an admin', () => {
			// GIVEN an org-owned template (owner null) and an admin actor [management-logic.ts:13]
			expect(
				decideTemplateEdit({
					ownerUserId: null,
					actorUserId: 'u1',
					actorIsAdmin: true,
				}),
			).toBe('in_place')
		})

		it('should fork for a non-admin member', () => {
			// GIVEN an org-owned template and a non-admin member [management-logic.ts:13]
			// THEN the member gets a personal copy rather than editing the shared one
			expect(
				decideTemplateEdit({
					ownerUserId: null,
					actorUserId: 'u1',
					actorIsAdmin: false,
				}),
			).toBe('fork')
		})
	})

	describe("when the template is another member's personal template", () => {
		it('should deny even for an admin', () => {
			// GIVEN a personal template owned by someone else [management-logic.ts:13]
			// THEN it is denied — RLS hides it, and admin does not grant edit access
			expect(
				decideTemplateEdit({
					ownerUserId: 'u2',
					actorUserId: 'u1',
					actorIsAdmin: false,
				}),
			).toBe('deny')
			expect(
				decideTemplateEdit({
					ownerUserId: 'u2',
					actorUserId: 'u1',
					actorIsAdmin: true,
				}),
			).toBe('deny')
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
