import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// The `@better-auth/oauth-provider` + `jwt` plugins (added for the OAuth MCP
// path) create `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`,
// `oauthConsent`, and `jwks` through Better Auth's own migrator. Like `apikey`
// (0005), these are issued and verified only through Better Auth's owner pool;
// the request-scoped `app_user` role must never touch them — `jwks` holds the
// JWT signing keys, and the token tables back access-token issuance. The 0001
// default-privileges grant hands app_user full DML on every new table, so pull
// it back. camelCase table names are quoted; `jwks` is lowercase.
//
// `mcp_oauth_org` maps an OAuth `(user, client)` pair to the organization its
// MCP access tokens act in (single-org users are auto-resolved and never get a
// row). It is written by the org-selection endpoint and read by the /mcp Bearer
// branch, both through the owner pool, so app_user gets no access either. ON
// DELETE CASCADE clears the row when its org is deleted; a live-membership
// re-check at request time guards against a user who left the org.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`REVOKE ALL PRIVILEGES ON "oauthClient" FROM app_user`
	yield* sql`REVOKE ALL PRIVILEGES ON "oauthAccessToken" FROM app_user`
	yield* sql`REVOKE ALL PRIVILEGES ON "oauthRefreshToken" FROM app_user`
	yield* sql`REVOKE ALL PRIVILEGES ON "oauthConsent" FROM app_user`
	yield* sql`REVOKE ALL PRIVILEGES ON jwks FROM app_user`

	yield* sql`
		CREATE TABLE IF NOT EXISTS mcp_oauth_org (
			user_id text NOT NULL,
			client_id text NOT NULL,
			organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
			updated_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (user_id, client_id)
		)
	`
	// Index the FK so org deletion's CASCADE check and any org-scoped lookup
	// don't seq-scan (house style: every organization_id column is indexed).
	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_mcp_oauth_org_org ON mcp_oauth_org (organization_id)
	`
	yield* sql`REVOKE ALL PRIVILEGES ON mcp_oauth_org FROM app_user`
})
