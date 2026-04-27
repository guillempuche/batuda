import { describe, it } from 'vitest'

// Multi-org bootstrap contract for the inviteAdmin orchestrator.
//
// These cases assume a fixture with:
//   - real Postgres connection (not mocked) so Better Auth's UNIQUE
//     constraints on (organization.slug) and (member.userId, organizationId)
//     fire as they would in production
//   - in-process Better Auth instance built from the same buildBetterAuthConfig
//     the server uses, so plugin behaviour matches runtime
//   - a fake MagicLinkSender that records calls instead of sending mail
//
// Until the Postgres harness lands (#33) these scenarios are it.todo. Each
// one names the invariant it guards so a future implementer can write the
// test without re-deriving the contract.
//
// Pure-logic coverage of the orchestration flow itself doesn't fit here —
// every meaningful branch crosses a write boundary (organization, user,
// member tables) that the harness has to provide.

describe('inviteAdmin', () => {
	describe('org does not exist', () => {
		it.todo(
			// GIVEN no row in "organization" with slug='acme'
			// AND no row in "user" with email='alice@acme.com'
			// WHEN inviteAdmin runs with { email, name, orgName, orgSlug='acme' }
			// THEN exactly one row appears in "organization" with slug='acme'
			// AND exactly one row appears in "user" with email='alice@acme.com'
			// AND exactly one row appears in "member" with role='owner' joining the two
			//   (Better Auth's createOrganization assigns the creator as owner; the
			//    return shape carries assignedRole='owner')
			// AND the magicLink.send callback was invoked once with that email
			'creates the org, the user, and an owner membership in one shot',
		)
	})

	describe('user exists but org does not', () => {
		it.todo(
			// GIVEN an existing user alice@acme.com (created by an earlier flow)
			// AND no row in "organization" with slug='acme'
			// WHEN inviteAdmin runs with that email + orgSlug='acme'
			// THEN no second user row is created (email is globally unique)
			// AND alice is attached as 'owner' of the new org
			// AND the magic link is still issued (fresh login token)
			'reuses the existing user as the new org owner',
		)
	})

	describe('user exists in a different org, allowExistingOrg=true', () => {
		it.todo(
			// GIVEN alice is already a member of org_taller as 'member'
			// AND org_restaurant exists
			// WHEN inviteAdmin runs with { orgSlug='restaurant', allowExistingOrg=true } for alice
			// THEN no second user row is created
			// AND alice has two member rows: taller(member) + restaurant(admin)
			// AND assignedRole is 'admin' (not 'owner') — pre-existing orgs use admin
			// AND the magic link is still issued
			'adds the existing user as admin of the pre-existing org',
		)
	})

	describe('slug already taken, allowExistingOrg=false', () => {
		it.todo(
			// GIVEN org with slug='acme' already exists
			// WHEN inviteAdmin runs with { orgSlug='acme', email='new@x.com' }
			//   (default behaviour — allowExistingOrg defaults to false)
			// THEN the helper fails with OrgSlugTaken({ slug: 'acme' })
			// AND no new "user" row is created (gate fires before user creation)
			// AND no new "member" row is created
			'surfaces OrgSlugTaken without partial writes',
		)
	})

	describe('user already a member of the same org', () => {
		it.todo(
			// GIVEN alice is already an admin of org_taller
			// WHEN inviteAdmin runs with { orgSlug='taller', allowExistingOrg=true } for alice
			// THEN the helper fails with AlreadyMember({ email, slug })
			// AND no second member row is created (UNIQUE (userId, organizationId))
			// AND alice's existing membership row is unchanged (no role downgrade)
			'surfaces AlreadyMember when the join already exists',
		)
	})

	describe('magic-link sender fails', () => {
		it.todo(
			// GIVEN the magicLink.send callback rejects with MagicLinkFailed
			// WHEN inviteAdmin runs (org and user creation succeed)
			// THEN the org, user, and member rows still exist (the user can be
			//   re-issued a link manually via /auth/sign-in/magic-link)
			// AND the helper surfaces MagicLinkFailed so the CLI can print a
			//   "user created but link not delivered" banner
			//
			// Open question — confirm with Guillem before locking in:
			// Should "magic-link failed" actually roll back the writes? Current
			// inviteUser.ts convention is "no" (consistent with the user-creation
			// step succeeding before the link send).
			'does not roll back the org/user/member writes',
		)
	})
})
