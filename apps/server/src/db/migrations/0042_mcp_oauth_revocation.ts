import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Which AI assistant connections have been cut off from which organization.
//
// The organizations a connection MAY act in are listed next door in
// `mcp_oauth_org_membership`, where an empty list means "nobody has chosen
// yet" and grants every organization the person belongs to. Being cut off is
// therefore recorded here as a fact of its own — not allowed in this
// organization, who said so, and when — rather than as the absence of a
// choice, so that taking away the last organization closes a connection
// instead of opening it up.
//
// `organization_id` deliberately carries NO foreign key: deleting an
// organization must not quietly lift a block placed inside it.
//
// `revoked_by_user_id` is what stops a blocked member from letting themselves
// back in by choosing the organization again — only a block they raised
// themselves may be cleared that way.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE TABLE IF NOT EXISTS mcp_oauth_revocation (
			user_id text NOT NULL,
			client_id text NOT NULL,
			organization_id text NOT NULL,
			revoked_at timestamptz NOT NULL DEFAULT now(),
			revoked_by_user_id text NOT NULL,
			PRIMARY KEY (user_id, client_id, organization_id)
		)
	`
	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_mcp_oauth_revocation_org
		ON mcp_oauth_revocation (organization_id)
	`

	// ── Privileges ──
	// Unlike the membership table, app_user is granted here on purpose:
	// revoking happens on the ordinary request path, which runs as app_user
	// with the active org set.
	//
	// The resolver role reads (every assistant request checks for a block) and
	// deletes: choosing the organization again has to be able to lift a block
	// you placed on yourself, or an accidental one would be permanent. It can
	// only ever lift its own — the policy below confines it to this person's
	// rows, and the delete additionally requires that the same person raised
	// the block, so an owner's stands.
	yield* sql`
		GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_oauth_revocation TO app_user
	`
	yield* sql`GRANT SELECT, DELETE ON mcp_oauth_revocation TO app_mcp_resolver`

	// ── RLS ──
	// FORCE so the policies apply to the table owner too — the connection
	// authenticates as the owner and switches role per request, and without
	// FORCE any path that forgot to switch would see every row.
	yield* sql`ALTER TABLE mcp_oauth_revocation ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE mcp_oauth_revocation FORCE ROW LEVEL SECURITY`

	// Policies are per-role and OR together, so these two never widen each
	// other: the request path is confined to one organization — so the database
	// itself refuses a block aimed at another one, rather than trusting the
	// caller — and the resolver role is confined to one person.
	yield* sql`
		CREATE POLICY org_isolation_mcp_oauth_revocation
		ON mcp_oauth_revocation
		TO app_user
		USING (organization_id = current_setting('app.current_org_id', true))
		WITH CHECK (organization_id = current_setting('app.current_org_id', true))
	`
	yield* sql`
		CREATE POLICY user_isolation_mcp_oauth_revocation
		ON mcp_oauth_revocation
		TO app_mcp_resolver
		USING (user_id = current_setting('app.current_user_id', true))
	`
})
