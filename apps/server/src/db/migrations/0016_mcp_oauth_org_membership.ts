import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Multi-organization MCP OAuth connections. The previous model bound a
// `(user, client)` pair to exactly one organization via `mcp_oauth_org`
// (PRIMARY KEY user_id, client_id). Multi-organization users could not
// authorize the same MCP client to act across several of their workspaces;
// they had to either land on an unbound connection or pick a single org.
//
// This migration replaces the singular selection with a membership-style
// join table `mcp_oauth_org_membership(user_id, client_id, organization_id)`
// whose PK spans all three columns, so one connection can carry several
// orgs. Existing rows are back-filled into the new shape.
//
// RLS: the new table inherits the same `app_mcp_resolver`-scoped isolation
// pattern as the old one (0007) — the resolver role gets SELECT/INSERT/
// UPDATE/DELETE and a `user_isolation_mcp_oauth_org_membership` policy keyed
// on `app.current_user_id`. The old `mcp_oauth_org` policy + table are
// dropped together.
//
// Forward-only: production has already run 0006/0007, so editing those in
// place would be wrong. The new shape lives here and supersedes them.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	// ── New table ──
	yield* sql`
		CREATE TABLE IF NOT EXISTS mcp_oauth_org_membership (
			user_id text NOT NULL,
			client_id text NOT NULL,
			organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
			updated_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (user_id, client_id, organization_id)
		)
	`
	// Index the FK so org deletion's CASCADE check and any org-scoped lookup
	// don't seq-scan (house style: every organization_id column is indexed).
	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_mcp_oauth_org_membership_org
		ON mcp_oauth_org_membership (organization_id)
	`

	// ── Back-fill existing selections into the new shape ──
	// Idempotent on the (user_id, client_id, organization_id) PK, so a
	// re-run after a partial failure doesn't double-insert.
	yield* sql`
		INSERT INTO mcp_oauth_org_membership (user_id, client_id, organization_id, updated_at)
		SELECT user_id, client_id, organization_id, updated_at
		FROM mcp_oauth_org
		ON CONFLICT (user_id, client_id, organization_id) DO NOTHING
	`

	// ── Privileges ──
	// app_user was already revoked on the old table in 0006; mirror that
	// here so the default-privileges grant from 0001 doesn't silently hand
	// app_user DML on the new table.
	yield* sql`REVOKE ALL PRIVILEGES ON mcp_oauth_org_membership FROM app_user`
	yield* sql`
		GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_oauth_org_membership TO app_mcp_resolver
	`

	// ── RLS ──
	yield* sql`ALTER TABLE mcp_oauth_org_membership ENABLE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY user_isolation_mcp_oauth_org_membership
		ON mcp_oauth_org_membership
		TO app_mcp_resolver
		USING (user_id = current_setting('app.current_user_id', true))
		WITH CHECK (user_id = current_setting('app.current_user_id', true))
	`

	// ── Drop the old table ──
	// Drop the old policy first (it would cascade with the table, but be
	// explicit so the audit trail in \d+ reads cleanly).
	yield* sql`
		DROP POLICY IF EXISTS user_isolation_mcp_oauth_org ON mcp_oauth_org
	`
	yield* sql`DROP TABLE IF EXISTS mcp_oauth_org`
})
