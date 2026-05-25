import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Better Auth's `organization`/`member`/`invitation`/`apikey` tables were
// created by its own migrator and left without RLS in 0001_initial.ts, while
// app_user kept the broad DML grant on them (0001:1268). The request path omits
// the org predicate by house style, trusting RLS to scope the read — but for
// these tables there was no policy, so a predicate-less `SELECT * FROM member`
// under app_user would leak every org's membership. This adds the missing
// org-isolation backstop.
//
// ENABLE without FORCE on purpose: Better Auth connects through its own pool
// as the `batuda` table owner, and a non-FORCE policy never applies to the
// owner — so sign-in, org creation, membership, and the org-switcher keep
// reading across orgs unchanged. The request path switches to the non-owner
// `app_user` role, where the policy does apply and filters to the active org.
//
// "organizationId" is quoted: Better Auth tables use camelCase columns;
// the unquoted `organization_id` would fail with "column does not exist".

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`ALTER TABLE member ENABLE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY org_isolation_member ON member
			TO app_user
			USING ("organizationId" = current_setting('app.current_org_id', true))
	`

	yield* sql`ALTER TABLE invitation ENABLE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY org_isolation_invitation ON invitation
			TO app_user
			USING ("organizationId" = current_setting('app.current_org_id', true))
	`

	// `organization` is left un-policied on purpose. Its row is resolved by id
	// *before* the org GUC is set (the lookup is what decides which org to scope
	// to), and listing the orgs a user belongs to spans every org. Both read by
	// explicit `WHERE id` instead of leaning on a policy.

	// app_user has no read path to API keys — they are issued and verified
	// through Better Auth's owner pool, never the request-scoped role. The
	// 0001 grant handed app_user full DML on every table and the revoke list
	// (0001:1269) missed `apikey`; pull all of it back so "keys live behind the
	// Better Auth pool" is enforced by grants, not convention.
	yield* sql`REVOKE ALL PRIVILEGES ON apikey FROM app_user`
})
