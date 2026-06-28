import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Contact channels become the single source of truth for every reachable
// address. The per-platform scalar columns (email/phone/whatsapp/linkedin/
// instagram) and the email-suppression columns move off `contacts` and onto
// `contact_channels`: the email channel now owns its deliverability
// `verification` (discovery verdict) plus a send-suppression `status`
// (bounced/complained) that the mail worker's DSN handler writes and the send
// gate reads.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	// Suppression dimension on the channel — meaningful for email channels.
	yield* sql`
		ALTER TABLE contact_channels
			ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unknown',
			ADD COLUMN IF NOT EXISTS status_reason TEXT,
			ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ,
			ADD COLUMN IF NOT EXISTS soft_bounce_count INTEGER NOT NULL DEFAULT 0
	`

	// Drop the per-platform scalars and the email-suppression columns now
	// carried by the email channel.
	yield* sql`
		ALTER TABLE contacts
			DROP COLUMN IF EXISTS email,
			DROP COLUMN IF EXISTS phone,
			DROP COLUMN IF EXISTS whatsapp,
			DROP COLUMN IF EXISTS linkedin,
			DROP COLUMN IF EXISTS instagram,
			DROP COLUMN IF EXISTS email_status,
			DROP COLUMN IF EXISTS email_status_reason,
			DROP COLUMN IF EXISTS email_status_updated_at,
			DROP COLUMN IF EXISTS email_soft_bounce_count
	`
})
