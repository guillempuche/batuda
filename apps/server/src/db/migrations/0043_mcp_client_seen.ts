import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Which tool last used each API key or assistant connection, and when.
//
// A key or a connection is otherwise only as recognisable as the name someone
// typed when creating it, so a list of five reads as five identical rows. The
// assistant announces itself when it opens a session ("claude-code", "Cursor",
// "ChatGPT") and sends a User-Agent with every call; both are recorded here so
// a person can tell which tool a given key or connection belongs to.
//
// Both are self-reported by the caller, so treat them as a label that helps a
// person tell their own keys apart — never as proof of who is calling.
//
// `user_id` is part of the key because a single OAuth client is shared: every
// person connecting ChatGPT to the same organization arrives under one client
// id. Without it, two colleagues would overwrite each other's row.
//
// `last_seen_at` is only filled in for OAuth connections. API keys already
// have a last-used timestamp recorded against the key itself, and keeping a
// second clock for the same thing invites the two to disagree.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE TABLE IF NOT EXISTS mcp_client_seen (
			organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
			principal_kind text NOT NULL CHECK (principal_kind IN ('api_key', 'oauth')),
			principal_id text NOT NULL,
			user_id text NOT NULL,
			client_name text,
			client_version text,
			user_agent text,
			last_seen_at timestamptz,
			PRIMARY KEY (organization_id, principal_kind, principal_id, user_id)
		)
	`
	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_mcp_client_seen_org
		ON mcp_client_seen (organization_id)
	`

	yield* sql`
		GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_client_seen TO app_user, app_service
	`

	yield* sql`ALTER TABLE mcp_client_seen ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE mcp_client_seen FORCE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY org_isolation_mcp_client_seen
		ON mcp_client_seen
		TO app_user
		USING (organization_id = current_setting('app.current_org_id', true))
		WITH CHECK (organization_id = current_setting('app.current_org_id', true))
	`
})
