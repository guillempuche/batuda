import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

/**
 * Thread read tracking, local inbox metadata, recipient role shape,
 * and search/pagination indexes.
 *
 * - New `inboxes` table with local metadata (purpose, owner, default, active)
 *   mirroring provider-side inboxes. `provider_inbox_id` is the stable key.
 * - `email_thread_links.last_read_at` drives the unread indicator.
 * - `email_thread_links.inbox_id` FK to `inboxes(id)` — backfilled from
 *   distinct `provider_inbox_id` values already referenced by threads.
 * - `email_messages.recipients` JSONB: `string[]` → `{ to, cc, bcc }`.
 * - Indexes: subject search (lowercase), filtered pagination, thread status.
 */
export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	// ── inboxes table ────────────────────────────────────────────────
	yield* sql`
		CREATE TABLE inboxes (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			provider TEXT NOT NULL,
			provider_inbox_id TEXT NOT NULL,
			email TEXT NOT NULL,
			display_name TEXT,
			purpose TEXT NOT NULL CHECK (purpose IN ('human','agent','shared')),
			owner_user_id TEXT,
			is_default BOOLEAN NOT NULL DEFAULT false,
			active BOOLEAN NOT NULL DEFAULT true,
			client_id TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			UNIQUE (provider, provider_inbox_id)
		)
	`
	yield* Effect.all([
		sql`CREATE INDEX idx_inboxes_purpose ON inboxes(purpose) WHERE active = true`,
		sql`CREATE INDEX idx_inboxes_owner_user_id ON inboxes(owner_user_id) WHERE owner_user_id IS NOT NULL`,
		sql`CREATE UNIQUE INDEX idx_inboxes_single_default ON inboxes((1)) WHERE is_default = true`,
	])

	// Backfill: one `inbox` row per distinct (provider, provider_inbox_id)
	// referenced by existing threads. Purpose defaults to 'shared' — operators
	// classify further via the management UI.
	yield* sql`
		INSERT INTO inboxes (provider, provider_inbox_id, email, purpose)
		SELECT DISTINCT provider, provider_inbox_id, provider_inbox_id, 'shared'
		FROM email_thread_links
	`

	// ── email_thread_links: inbox_id FK, last_read_at, indexes ──────
	yield* Effect.all([
		sql`ALTER TABLE email_thread_links ADD COLUMN inbox_id UUID`,
		sql`ALTER TABLE email_thread_links ADD COLUMN last_read_at TIMESTAMPTZ`,
	])
	yield* sql`
		UPDATE email_thread_links t
		SET inbox_id = i.id
		FROM inboxes i
		WHERE t.provider = i.provider
		  AND t.provider_inbox_id = i.provider_inbox_id
	`
	yield* sql`
		ALTER TABLE email_thread_links
		ADD CONSTRAINT email_thread_links_inbox_id_fkey
		FOREIGN KEY (inbox_id) REFERENCES inboxes(id) ON DELETE SET NULL
	`
	yield* Effect.all([
		sql`CREATE INDEX idx_email_thread_links_inbox_id ON email_thread_links(inbox_id)`,
		sql`CREATE INDEX idx_email_thread_links_subject_lower ON email_thread_links(lower(subject))`,
		sql`CREATE INDEX idx_email_thread_links_status_updated ON email_thread_links(provider_inbox_id, status, updated_at DESC)`,
	])

	// ── email_messages.recipients: string[] → { to, cc, bcc } ───────
	yield* sql`
		UPDATE email_messages
		SET recipients = jsonb_build_object(
			'to', recipients,
			'cc', '[]'::jsonb,
			'bcc', '[]'::jsonb
		)
	`
})
