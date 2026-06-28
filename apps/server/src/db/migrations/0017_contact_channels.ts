import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Multi-channel contacts. The `contacts` row keeps its scalar `email` — the
// canonical send address the outbound email path reads — alongside the older
// phone/whatsapp/linkedin/instagram columns. This table adds an open-ended set
// of reachable channels per contact (x, website, bluesky, mastodon, …) without
// a column per platform: `kind` is free text, so a new channel needs no
// migration. Only the email channel carries a deliverability `verification`.
//
// RLS mirrors the CRM tables: org isolation keyed on `app.current_org_id`,
// scoped TO app_user (the HTTP + MCP request role); app_service keeps its
// BYPASSRLS posture for the worker/cron paths.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE TABLE IF NOT EXISTS contact_channels (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id TEXT NOT NULL,
			contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
			kind TEXT NOT NULL,
			value TEXT NOT NULL,
			verification TEXT,
			confidence INTEGER,
			is_primary BOOLEAN NOT NULL DEFAULT false,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`

	yield* sql`CREATE INDEX IF NOT EXISTS idx_contact_channels_contact ON contact_channels(contact_id)`
	yield* sql`CREATE INDEX IF NOT EXISTS idx_contact_channels_org ON contact_channels(organization_id)`
	// One row per (contact, kind, value) so re-discovering the same handle is a
	// no-op rather than a duplicate.
	yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_channels_unique ON contact_channels(contact_id, kind, value)`

	yield* sql`GRANT SELECT, INSERT, UPDATE, DELETE ON contact_channels TO app_user, app_service`

	yield* sql`ALTER TABLE contact_channels ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE contact_channels FORCE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY org_isolation_contact_channels ON contact_channels
			TO app_user
			USING (organization_id = current_setting('app.current_org_id', true))
			WITH CHECK (organization_id = current_setting('app.current_org_id', true))
	`
})
