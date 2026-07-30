import { describe, expect, it } from 'vitest'

import { isOrgManager } from './current-org'

describe('isOrgManager', () => {
	describe('when the role runs the organization', () => {
		it('should admit the owner', () => {
			// GIVEN the role of the person who created the organization
			// WHEN asked whether they may manage it
			// THEN they may
			expect(isOrgManager('owner')).toBe(true)
		})

		it('should admit an admin', () => {
			// GIVEN a member promoted to admin
			// WHEN asked whether they may manage the organization
			// THEN they may, on equal footing with the owner
			expect(isOrgManager('admin')).toBe(true)
		})
	})

	describe('when the role does not run the organization', () => {
		it('should refuse an ordinary member', () => {
			// GIVEN a plain member
			// WHEN asked whether they may manage the organization
			// THEN they may not, so they can only ever act for themselves
			expect(isOrgManager('member')).toBe(false)
		})

		it('should refuse work with nobody behind it', () => {
			// GIVEN no acting person at all, as with work that runs unattended
			// WHEN asked whether it may manage the organization
			// THEN it may not: unattended work never acts for a person
			expect(isOrgManager(null)).toBe(false)
		})
	})

	describe('when the role is not one it knows', () => {
		it('should refuse a role added later', () => {
			// GIVEN a role this check has never been taught about
			// WHEN asked whether it may manage the organization
			// THEN it refuses, so a new role starts with no authority rather
			// than inheriting someone else's
			expect(isOrgManager('billing')).toBe(false)
		})

		it('should refuse an empty role', () => {
			// GIVEN a membership row whose role never got written
			// WHEN asked whether it may manage the organization
			// THEN it refuses rather than reading blank as permission
			expect(isOrgManager('')).toBe(false)
		})
	})
})
