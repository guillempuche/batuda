import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// A database backstop for the per-user OAuth data the connections page and the
// /mcp org-resolution read: a hand-written `WHERE userId = …` is the only thing
// keeping one member from seeing another's connections, with nothing under it.
//
// `app_mcp_resolver` is a dedicated NOLOGIN role those reads run as (the owner
// pool bypasses RLS, so the reads have to switch into a constrained role for a
// policy to bite). It's kept separate from `app_user` on purpose: these
// policies key on the current user, and `app_user`'s membership reads elsewhere
// are keyed on the active org — mixing them would widen what `app_user` sees
// across the whole app. PUBLIC has no table access (revoked in 0001), so the
// role is granted schema usage and exactly the privileges it needs.
//
// What enforces the isolation is running the reads as the non-superuser
// `app_mcp_resolver` role, which these policies bind. Better Auth keeps issuing
// tokens and recording consent through its owner connection, which bypasses RLS
// untouched. RLS is ENABLEd (not FORCEd) — FORCE would only matter for a
// non-superuser table owner, which the connection role isn't.
// Each policy compares against `app.current_user_id`, set just before the reads;
// if it's unset the comparison matches no rows, so a read that forgets to enter
// the scope fails closed rather than leaking.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		DO $$
		BEGIN
			IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_mcp_resolver') THEN
				CREATE ROLE app_mcp_resolver NOLOGIN;
			END IF;
		END
		$$
	`
	// PG 16 only permits `SET LOCAL ROLE` into a role granted WITH SET (see 0002).
	yield* sql`GRANT app_mcp_resolver TO CURRENT_USER WITH SET TRUE`
	yield* sql`GRANT USAGE ON SCHEMA public TO app_mcp_resolver`

	yield* sql`GRANT SELECT ON "oauthConsent" TO app_mcp_resolver`
	yield* sql`GRANT SELECT ON "oauthClient" TO app_mcp_resolver`
	yield* sql`GRANT SELECT ON member TO app_mcp_resolver`
	yield* sql`GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_oauth_org TO app_mcp_resolver`

	yield* sql`ALTER TABLE "oauthConsent" ENABLE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY user_isolation_oauth_consent ON "oauthConsent"
			TO app_mcp_resolver
			USING ("userId" = current_setting('app.current_user_id', true))
	`

	yield* sql`ALTER TABLE mcp_oauth_org ENABLE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY user_isolation_mcp_oauth_org ON mcp_oauth_org
			TO app_mcp_resolver
			USING (user_id = current_setting('app.current_user_id', true))
			WITH CHECK (user_id = current_setting('app.current_user_id', true))
	`

	// `member` already has RLS (0005, org-scoped for app_user). Add a user-scoped
	// policy for the resolver so it reads all of the caller's memberships across
	// orgs when picking the org a token acts in. Policies are per-role, so this
	// leaves app_user's org-scoped policy untouched.
	yield* sql`
		CREATE POLICY user_isolation_member_resolver ON member
			TO app_mcp_resolver
			USING ("userId" = current_setting('app.current_user_id', true))
	`
})
