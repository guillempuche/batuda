import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// A way of reaching somebody could only ever belong to a person, so a company
// could hold exactly one mailbox, one telephone number, one of each. That fits a
// single-site owner-run business and stops describing a company the moment it has
// two shops, a sales office and a support office, or one legal entity trading
// under three names.
//
// `channels` names what it belongs to by table and id, the way `document_links`
// already does, so the same row shape serves a company and a person. Its
// `subject_id` carries no foreign key, because one key cannot point at two
// tables — which is also why the seed reset has to name this table explicitly:
// it no longer inherits the clearing that came free with the old link to a
// person.
//
// `label` is what turns several mailboxes into something usable rather than a
// pile of addresses: "Girona shop" and "sales office" tell a person which one to
// write to, and neither the web app nor an assistant could tell them apart
// without it.
//
// Two columns are renamed on the way: `kind` becomes `channel` and `value`
// becomes `address`. Both old names read as "some field of something" wherever
// they appear in a query; the new ones say what they hold. This was queued as its
// own piece of work, and folding it in here is materially less work than doing it
// twice over the same eight files.
//
// The address is also indexed on its own, lower-cased, per organisation. That is
// the question the send gate has to ask — "has this address bounced?" — which
// until now it could only ask about a named person, so a company mailbox that
// hard-bounced was retried forever.
//
// expand-contract: pre-production clean break — this same release rewrites every
// reader and writer of `contact_channels` (the channel service and its four
// callers, the HTTP contact routes, the MCP contact and email tools, the bounce
// handler, the participant matcher, research apply, and the seeds) onto this
// table. Nothing queries the dropped table once this deploy is out. Existing rows
// are carried over, so no reachable address is lost.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE TABLE IF NOT EXISTS channels (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id TEXT NOT NULL,
			subject_table TEXT NOT NULL CHECK (subject_table IN ('companies','contacts')),
			subject_id UUID NOT NULL,
			channel TEXT NOT NULL,
			address TEXT NOT NULL,
			-- Which of several this one is, in a person's words: "Girona shop",
			-- "sales office", "switchboard". Null when there is only one and no
			-- distinction to draw.
			label TEXT,
			verification TEXT,
			confidence INTEGER,
			is_primary BOOLEAN NOT NULL DEFAULT false,
			status TEXT NOT NULL DEFAULT 'unknown',
			status_reason TEXT,
			status_updated_at TIMESTAMPTZ,
			soft_bounce_count INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`

	// One row per way of reaching one subject: writing the same address twice
	// refreshes it rather than stacking duplicates.
	yield* sql`
		CREATE UNIQUE INDEX IF NOT EXISTS channels_subject_address_idx
			ON channels (subject_table, subject_id, channel, address)
	`
	// "How do I reach this record" — every company and contact panel asks it.
	yield* sql`CREATE INDEX IF NOT EXISTS channels_subject_idx ON channels(subject_table, subject_id)`
	// "Has this address bounced?" — asked of every recipient before a send, and
	// answerable now without knowing whose address it is. Lower-cased because an
	// address that bounced is the same address whatever case it was typed in.
	yield* sql`
		CREATE INDEX IF NOT EXISTS channels_org_address_idx
			ON channels (organization_id, channel, lower(address))
	`
	yield* sql`CREATE INDEX IF NOT EXISTS idx_channels_org ON channels(organization_id)`

	yield* sql`GRANT SELECT, INSERT, UPDATE, DELETE ON channels TO app_user, app_service`

	yield* sql`ALTER TABLE channels ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE channels FORCE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY org_isolation_channels ON channels
			TO app_user
			USING (organization_id = current_setting('app.current_org_id', true))
			WITH CHECK (organization_id = current_setting('app.current_org_id', true))
	`

	// Every address on file today belongs to a person, and keeps belonging to
	// them — including its bounce bookkeeping, so an address suppressed before
	// this release stays suppressed after it.
	yield* sql`
		INSERT INTO channels (
			id, organization_id, subject_table, subject_id, channel, address,
			verification, confidence, is_primary,
			status, status_reason, status_updated_at, soft_bounce_count,
			created_at, updated_at
		)
		SELECT
			id, organization_id, 'contacts', contact_id, kind, value,
			verification, confidence, is_primary,
			status, status_reason, status_updated_at, soft_bounce_count,
			created_at, updated_at
		FROM contact_channels
		ON CONFLICT DO NOTHING
	`

	yield* sql`DROP TABLE IF EXISTS contact_channels`
})
