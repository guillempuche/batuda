import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Tell two folders' messages apart when they are numbered the same.
//
// A message's number is only its own within one folder. Two folders on the same
// server are free to hand out the same numbers, and often do: the number a
// server starts a folder at is commonly taken from the clock when the folder was
// made, and a mailbox's folders are usually made in the same second.
//
// The rule that stops the same message being stored twice was written without
// the folder, so message 7 of the sent folder counted as message 7 of the inbox
// already stored — and was dropped. Nothing said so; the message was simply
// never there. This became reachable when the sent folder started being read on
// providers that do not call it "Sent".
//
// The old rule is replaced rather than kept alongside: while both exist the old
// one still refuses the second folder's message, which is the whole problem.
// Nothing in the application names this index when it stores a message — it asks
// only that a message it already holds be left alone, whichever rule says so —
// so replacing it needs no matching change to shipped code, in either order.
//
// expand-contract: the drop and the replacement sit in one migration, and in the
// moment between them two folders could both store a message that is really one.
// That window is a single statement wide and costs a duplicate row, where
// leaving the old rule in place costs a message.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_email_messages_imap_dedupe_folder
		ON email_messages(inbox_id, folder, imap_uidvalidity, imap_uid)
		WHERE imap_uid IS NOT NULL
	`
	yield* sql`DROP INDEX IF EXISTS idx_email_messages_imap_dedupe`
})
