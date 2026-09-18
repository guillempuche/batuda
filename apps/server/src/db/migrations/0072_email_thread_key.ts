import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Say on each message which conversation it belongs to.
//
// Until now that question was answered by looking for the conversation's first
// message id inside the message's own id or its chain of ancestors — an array
// test. Postgres will not use the index behind that test while row security is
// in force, because it cannot prove the test is safe to run on rows the reader
// may not see. So every "which messages are in this thread" lookup read every
// message the organisation holds, once per thread on screen: a hundred threads
// meant a hundred full passes, and a screenful of mail took about two thirds of
// a second on a mailbox of fifteen thousand messages.
//
// Written down as a plain value, the same question is an ordinary comparison
// the index answers in microseconds. The column is filled in by whoever stores
// the message, and the value is the conversation's first message id — the same
// one the thread row carries.
//
// `is_delivery_notice` marks a message that is a delivery failure notice rather
// than something a person wrote. They arrive as ordinary incoming mail and,
// when the mail server that sent them chains them to the message that failed,
// they would otherwise count as the conversation's latest message and make it
// read as if somebody were waiting for an answer. Notices stored before this
// column existed are not marked, so old conversations keep the old behaviour.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE email_messages
			ADD COLUMN IF NOT EXISTS thread_key TEXT,
			ADD COLUMN IF NOT EXISTS is_delivery_notice BOOLEAN NOT NULL DEFAULT false
	`

	// Fill in what is already stored, through the slow test this column exists
	// to replace. It runs once, outside a request, where the slowness is fine.
	yield* sql`
		UPDATE email_messages m
		SET thread_key = chosen.external_thread_id
		FROM (
			SELECT DISTINCT ON (em.id)
				em.id AS message_id,
				tl.external_thread_id
			FROM email_messages em
			JOIN email_thread_links tl
			  ON tl.organization_id = em.organization_id
			 AND (
			   em.message_id = tl.external_thread_id
			   OR em."references" @> ARRAY[tl.external_thread_id]::text[]
			 )
			WHERE em.thread_key IS NULL
			-- A conversation split in two before this column existed can leave a
			-- message that two rows both claim. The oldest wins, so running this
			-- twice on the same data files it the same way both times.
			ORDER BY em.id, tl.created_at ASC, tl.id ASC
		) chosen
		WHERE chosen.message_id = m.id
	`

	// A message nobody filed into a conversation still answers for itself, so
	// its own id stands in. Without this such a message would belong to no
	// thread at all once reads go through this column.
	yield* sql`
		UPDATE email_messages
		SET thread_key = message_id
		WHERE thread_key IS NULL
	`

	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_email_messages_thread_key
			ON email_messages (organization_id, thread_key)
	`
})
