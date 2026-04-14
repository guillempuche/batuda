import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	// ── email_thread_links: rename AgentMail-specific columns ──
	yield* Effect.all([
		sql`ALTER TABLE email_thread_links RENAME COLUMN agentmail_thread_id TO provider_thread_id`,
		sql`ALTER TABLE email_thread_links RENAME COLUMN agentmail_inbox_id TO provider_inbox_id`,
		sql`ALTER TABLE email_thread_links ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'agentmail'`,
	])
	yield* sql`ALTER TABLE email_thread_links ALTER COLUMN provider DROP DEFAULT`

	// ── email_messages: rename AgentMail-specific columns; add provider + classification ──
	yield* Effect.all([
		sql`ALTER TABLE email_messages RENAME COLUMN agentmail_message_id TO provider_message_id`,
		sql`ALTER TABLE email_messages RENAME COLUMN agentmail_thread_id TO provider_thread_id`,
		sql`ALTER TABLE email_messages RENAME COLUMN agentmail_inbox_id TO provider_inbox_id`,
		sql`ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'agentmail'`,
		sql`ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS inbound_classification TEXT CHECK (inbound_classification IN ('normal','spam','blocked'))`,
	])
	yield* sql`ALTER TABLE email_messages ALTER COLUMN provider DROP DEFAULT`

	// ── Index renames + partial index for default inbox filter ──
	yield* Effect.all([
		sql`ALTER INDEX IF EXISTS idx_email_thread_links_inbox_id RENAME TO idx_email_thread_links_provider_inbox_id`,
		sql`ALTER INDEX IF EXISTS idx_email_messages_thread_id RENAME TO idx_email_messages_provider_thread_id`,
		sql`
			CREATE INDEX IF NOT EXISTS idx_email_messages_inbound_active
			ON email_messages(created_at DESC)
			WHERE direction = 'inbound' AND (inbound_classification IS NULL OR inbound_classification = 'normal')
		`,
	])

	// ── UNIQUE constraint identifiers: Postgres auto-rewrites column refs
	//    inside constraint definitions but keeps the constraint identifier;
	//    rename them so introspection matches the new column names. ──
	yield* Effect.all([
		sql`ALTER TABLE email_messages RENAME CONSTRAINT email_messages_agentmail_message_id_key TO email_messages_provider_message_id_key`,
		sql`ALTER TABLE email_thread_links RENAME CONSTRAINT email_thread_links_agentmail_thread_id_key TO email_thread_links_provider_thread_id_key`,
	])
})
