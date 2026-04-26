import { describe, expect, it } from 'vitest'

import { OrgMiddlewareLive } from './org'

describe('OrgMiddlewareLive', () => {
	it('should be a Layer ready to provide OrgMiddleware', () => {
		// GIVEN the constructed middleware Layer
		// WHEN inspected at module-load time
		// THEN it exists as an object — sanity check that the module compiles and
		// exports the expected binding before any DB-backed scenarios light up
		expect(OrgMiddlewareLive).toBeDefined()
		expect(typeof OrgMiddlewareLive).toBe('object')
	})

	describe('session resolution', () => {
		it.todo(
			// GIVEN a request without a Better-Auth cookie / bearer
			// WHEN the middleware runs
			// THEN it fails with Unauthorized — defense in depth (SessionMiddleware
			// should already have stopped this path, but routes can opt-in to
			// OrgMiddleware standalone)
			'should fail Unauthorized when no session is present',
		)

		it.todo(
			// GIVEN a session whose activeOrganizationId is null
			// WHEN the middleware runs
			// THEN it fails Forbidden with a message pointing at /auth/organization/set-active
			// AND the API never sees a CurrentOrg the user did not explicitly select
			'should fail Forbidden when session has no activeOrganizationId',
		)

		it.todo(
			// GIVEN a session whose activeOrganizationId points at an org that no
			// longer exists (deleted, or session forged)
			// WHEN the middleware runs
			// THEN it fails Forbidden — the user cannot act in an org Postgres has
			// no row for
			'should fail Forbidden when the organization row is missing',
		)
	})

	describe('CurrentOrg provision', () => {
		it.todo(
			// GIVEN a valid session with activeOrganizationId = $org_alpha
			// AND organization row { id: $org_alpha, name: 'Alpha', slug: 'alpha' }
			// WHEN the middleware runs
			// THEN downstream effects yielding CurrentOrg see { id, name, slug }
			// matching the row, allowing handlers to build org-scoped URLs without
			// a second SELECT
			'should provide { id, name, slug } from the organization row',
		)

		it.todo(
			// GIVEN two members of two distinct orgs hitting the same handler
			// concurrently
			// WHEN the middleware runs for each
			// THEN each request sees its own CurrentOrg — request-scoped provision,
			// no cross-tenant leakage through a shared module-level cache
			'should scope CurrentOrg per request, not per process',
		)
	})
})
