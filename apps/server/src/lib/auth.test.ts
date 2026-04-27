import { describe, it } from 'vitest'

// Auto-active-org contract for the `databaseHooks.session.create.before`
// hook in `packages/auth/src/infrastructure/build-better-auth-config.ts`.
//
// The hook runs every time Better Auth issues a new session and decides
// whether to populate `session.activeOrganizationId` from the user's
// memberships. Single-org users (the common case) skip the picker;
// multi-org users must select explicitly via /auth/organization/set-active
// so the active scope is always intentional.
//
// These cases assume a fixture with:
//   - the same buildBetterAuthConfig used by the server (organization plugin
//     enabled so the `member` model exists)
//   - real Postgres so the adapter.findMany query against the member table
//     resolves the same way it does at runtime
//   - sign-in via auth.api.signInEmail to trigger the session.create path
//
// Until the Postgres harness lands (#33) these scenarios are it.todo.

describe('session.create databaseHook', () => {
	it.todo(
		// GIVEN alice has exactly one row in "member" (org_taller)
		// WHEN auth.api.signInEmail issues a session for alice
		// THEN session.activeOrganizationId equals org_taller.id
		// AND the org middleware downstream resolves CurrentOrg without 403
		'sets activeOrganizationId when user has exactly one membership',
	)

	it.todo(
		// GIVEN bob has rows in "member" for two orgs (taller + restaurant)
		// WHEN auth.api.signInEmail issues a session for bob
		// THEN session.activeOrganizationId is null/undefined
		// AND the org middleware later 403s with the standard "set-active first"
		//   message until /auth/organization/set-active is called explicitly
		'leaves activeOrganizationId unset when user has multiple memberships',
	)

	it.todo(
		// GIVEN dave has no rows in "member" (edge: bootstrap-org race, or a
		//   user created outside the inviteAdmin helper)
		// WHEN auth.api.signInEmail issues a session for dave
		// THEN session.activeOrganizationId is null/undefined
		// AND the org middleware 403s on every CurrentOrg-gated route
		//   (the user must be added to an org before they can use the app)
		'leaves activeOrganizationId unset when user has zero memberships',
	)

	it.todo(
		// GIVEN alice already has an activeOrganizationId carried in from
		//   a previous session (e.g. she switched orgs and signed back in)
		// WHEN auth.api.signInEmail issues a fresh session
		// THEN the hook's early-return preserves the existing value
		// AND no adapter.findMany query is executed (cheap path)
		'preserves an explicitly-set activeOrganizationId on re-sign-in',
	)
})
