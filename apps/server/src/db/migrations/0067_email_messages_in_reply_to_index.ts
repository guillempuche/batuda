import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Let the mail worker ask who answered a message.
//
// Filing an arriving message into a conversation used to look only backwards,
// at what the message itself names. That leaves a conversation in two halves
// whenever a reply is taken in before the message it answers — which is the
// ordinary order, not a rare one, because mail is read inbox first and sent
// folder second.
//
// So the worker now also looks forward: does a message we already hold name
// this one as an ancestor? Most of that question is answered by the existing
// GIN index over `references`. The rest is this one — a sender that trims the
// chain away sends only `In-Reply-To`, and without an index that half of the
// lookup reads every message in the table on every arrival.
//
// Partial, because a message that answers nothing stores NULL here and is never
// what the lookup is searching for.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_email_messages_in_reply_to
			ON email_messages (organization_id, in_reply_to)
			WHERE in_reply_to IS NOT NULL
	`
})
