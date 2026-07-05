import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Reseats the per-inbox email schema onto the channel-agnostic communications
// spine. Email is generalized to a "channel connection" so a future channel
// (a chat bot, an SMS line) reuses the same tables + transport port instead of
// forking the stack.
//
// expand-contract: pre-production — no running instance reads the old
// inbox/email_* shape, and every environment recreates the schema via
// `pnpm cli db reset`, so these renames need no rolling-deploy compatibility.
//
// This stacks on top of 0001/0004/0017/0018 rather than rewriting them (the
// project's recent migrations — 0017/0018 — did the same). Because Postgres
// tracks indexes, CHECK/FK constraints and RLS policies by OID/attnum, every
// RENAME below carries them automatically: the transitive `message_participants`
// RLS keeps pointing at the (now renamed) messages table, and the FTS column +
// dedupe indexes ride along with `email_messages → messages`. So this migration
// only RENAMEs and ADDs — it never recreates a policy or rebuilds an index.
//
// `member.primary_inbox_id → primary_connection_id`: 0001 creates the UUID
// column + FK (after Better Auth's `migrate.ts` seeds a TEXT baseline named
// `primary_inbox_id`), and this migration renames it. `migrate.ts` deliberately
// keeps `fieldName: 'primary_inbox_id'` (it only generates that pre-rename
// baseline), while the runtime config in `lib/auth.ts` reads
// `primary_connection_id`. The two disagree on purpose — they describe the
// schema at different points in the migration order.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	// ── Rename tables ────────────────────────────────────────────────
	yield* sql`ALTER TABLE inboxes RENAME TO channel_connections`
	yield* sql`ALTER TABLE email_thread_links RENAME TO conversations`
	yield* sql`ALTER TABLE email_messages RENAME TO messages`
	yield* sql`ALTER TABLE inbox_footers RENAME TO connection_footers`

	// ── channel_connections: generalize the mailbox row ──────────────
	// The mailbox address becomes the generic per-channel handle; the
	// encrypted password triple becomes a generic secret-config blob (a
	// password today, OAuth tokens in the OAuth slice); folder_state becomes
	// the generic per-connection sync cursor.
	yield* sql`ALTER TABLE channel_connections RENAME COLUMN email TO external_id`
	yield* sql`ALTER TABLE channel_connections RENAME COLUMN password_ciphertext TO config_ciphertext`
	yield* sql`ALTER TABLE channel_connections RENAME COLUMN password_nonce TO config_nonce`
	yield* sql`ALTER TABLE channel_connections RENAME COLUMN password_tag TO config_tag`
	yield* sql`ALTER TABLE channel_connections RENAME COLUMN folder_state TO sync_state`
	// `channel` is the comms channel (closed set); `provider` selects the
	// transport + auth mechanism. Existing rows are basic-auth email mailboxes.
	yield* sql`
		ALTER TABLE channel_connections
			ADD COLUMN channel TEXT NOT NULL DEFAULT 'email'
				CHECK (channel IN ('email'))
	`
	yield* sql`
		ALTER TABLE channel_connections
			ADD COLUMN provider TEXT NOT NULL DEFAULT 'imap-smtp'
				CHECK (provider IN ('imap-smtp','gmail-oauth','m365-oauth','local-inbox'))
	`
	// Queryable OAuth access-token expiry, for proactive refresh; NULL for
	// basic-auth connections.
	yield* sql`ALTER TABLE channel_connections ADD COLUMN token_expires_at TIMESTAMPTZ`
	yield* sql`
		ALTER TABLE channel_connections
			RENAME CONSTRAINT inboxes_purpose_owner_chk TO channel_connections_purpose_owner_chk
	`

	// ── Retarget FK columns onto the renamed connection/conversation ──
	yield* sql`ALTER TABLE conversations RENAME COLUMN inbox_id TO connection_id`
	yield* sql`ALTER TABLE messages RENAME COLUMN inbox_id TO connection_id`
	yield* sql`ALTER TABLE connection_footers RENAME COLUMN inbox_id TO connection_id`
	yield* sql`ALTER TABLE email_drafts RENAME COLUMN inbox_id TO connection_id`
	yield* sql`ALTER TABLE email_drafts RENAME COLUMN thread_link_id TO conversation_id`
	yield* sql`ALTER TABLE email_attachment_staging RENAME COLUMN inbox_id TO connection_id`
	yield* sql`ALTER TABLE tasks RENAME COLUMN linked_thread_link_id TO linked_conversation_id`

	// ── message_participants: channel-agnostic participant rows ───────
	yield* sql`ALTER TABLE message_participants RENAME COLUMN email_message_id TO message_id`
	yield* sql`ALTER TABLE message_participants RENAME COLUMN email_address TO address`
	yield* sql`
		ALTER TABLE message_participants
			ADD COLUMN channel TEXT NOT NULL DEFAULT 'email'
				CHECK (channel IN ('email'))
	`

	// ── member: the default From identity is now a connection ─────────
	yield* sql`ALTER TABLE "member" RENAME COLUMN primary_inbox_id TO primary_connection_id`
	yield* sql`
		ALTER TABLE "member"
			RENAME CONSTRAINT member_primary_inbox_id_fkey TO member_primary_connection_id_fkey
	`

	// ── contact_channels: one vocabulary with the spine ──────────────
	// The column stays free-text — it holds any reachable-handle kind
	// (email/phone/linkedin/website/…), a superset of the closed comms
	// `channel`, so no CHECK is added.
	yield* sql`ALTER TABLE contact_channels RENAME COLUMN kind TO channel`
	yield* sql`ALTER TABLE contact_channels RENAME COLUMN value TO address`

	// ── Rename indexes so names track the renamed tables/columns ─────
	// (RENAME already kept them functional against the new names; this is the
	// cosmetic follow-up so `\d` and EXPLAIN read cleanly.)
	yield* Effect.all([
		sql`ALTER INDEX idx_email_thread_links_company_id RENAME TO idx_conversations_company_id`,
		sql`ALTER INDEX idx_email_thread_links_inbox_id RENAME TO idx_conversations_connection_id`,
		sql`ALTER INDEX idx_email_thread_links_subject_lower RENAME TO idx_conversations_subject_lower`,
		sql`ALTER INDEX idx_email_thread_links_org_updated RENAME TO idx_conversations_org_updated`,
		sql`ALTER INDEX idx_email_messages_contact_id RENAME TO idx_messages_contact_id`,
		sql`ALTER INDEX idx_email_messages_status RENAME TO idx_messages_status`,
		sql`ALTER INDEX idx_email_messages_org_status RENAME TO idx_messages_org_status`,
		sql`ALTER INDEX idx_email_messages_imap_dedupe RENAME TO idx_messages_imap_dedupe`,
		sql`ALTER INDEX idx_email_messages_msgid RENAME TO idx_messages_msgid`,
		sql`ALTER INDEX idx_email_messages_references RENAME TO idx_messages_references`,
		sql`ALTER INDEX idx_email_messages_inbox_received RENAME TO idx_messages_connection_received`,
		sql`ALTER INDEX idx_email_messages_inbound_active RENAME TO idx_messages_inbound_active`,
		sql`ALTER INDEX idx_email_messages_search_vector RENAME TO idx_messages_search_vector`,
		sql`ALTER INDEX idx_inboxes_org RENAME TO idx_channel_connections_org`,
		sql`ALTER INDEX idx_inboxes_purpose RENAME TO idx_channel_connections_purpose`,
		sql`ALTER INDEX idx_inboxes_org_owner_active RENAME TO idx_channel_connections_org_owner_active`,
		sql`ALTER INDEX idx_inboxes_default_per_owner RENAME TO idx_channel_connections_default_per_owner`,
		sql`ALTER INDEX idx_inboxes_default_shared RENAME TO idx_channel_connections_default_shared`,
		sql`ALTER INDEX idx_inboxes_grant_status RENAME TO idx_channel_connections_grant_status`,
		sql`ALTER INDEX idx_inbox_footers_inbox_id RENAME TO idx_connection_footers_connection_id`,
		sql`ALTER INDEX idx_inbox_footers_single_default RENAME TO idx_connection_footers_single_default`,
		sql`ALTER INDEX idx_email_drafts_inbox RENAME TO idx_email_drafts_connection`,
		sql`ALTER INDEX idx_email_attachment_staging_inbox RENAME TO idx_email_attachment_staging_connection`,
		sql`ALTER INDEX idx_message_participants_email RENAME TO idx_message_participants_address`,
		sql`ALTER INDEX idx_member_primary_inbox RENAME TO idx_member_primary_connection`,
	])

	// ── New indexes for the generalized columns ──────────────────────
	// external_id is looked up by the inbound org-resolution path; the token
	// index drives the proactive OAuth-refresh scan.
	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_channel_connections_external_id
			ON channel_connections(organization_id, lower(external_id))
	`
	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_channel_connections_token_expires
			ON channel_connections(token_expires_at) WHERE token_expires_at IS NOT NULL
	`
})
