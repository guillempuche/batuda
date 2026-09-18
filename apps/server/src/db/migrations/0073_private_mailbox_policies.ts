import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Keep mail in a private mailbox to the person who owns it.
//
// A mailbox marked private belongs to one person. Until now only two reads
// checked that, and both asked the wrong question — they looked at the mailbox
// the conversation started in, not the mailbox each message arrived in. A
// message that came into a private mailbox but sits inside a conversation the
// team shares was readable by everyone, and so were its attachments, its place
// in the company's history, and the addresses on it.
//
// The rule now lives here, next to the rows, so it holds for every way of
// asking — the ones written today and the ones written next year. The database
// answers as if the message were not there: a list leaves it out, a lookup by
// id says not found, a change touches no rows.
//
// The rules are restrictive: they narrow what the organisation rule already
// allows rather than opening anything up. They apply to `app_user`, the role a
// request runs as. Background work (the mail worker, cron) runs as
// `app_service`, which is exempt, because it has to store and file mail for
// everybody.
//
// With nobody signed in — a webhook, say — `current_setting` reads back empty
// and matches no owner, so private mail stays hidden.
//
// Each rule is written so the database can still use its indexes for the rest
// of the query: it reads the mailbox by its key, and nothing here copies the
// privacy flag onto other tables, which would go stale the moment a mailbox
// changes hands.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	// A company's history points at the message it came from. It was written
	// inside a JSON bag, which no index can answer, so the rule below would
	// have had to sift every row: a company's own history took a tenth of a
	// second where a column takes a fifth of a millisecond.
	yield* sql`
		ALTER TABLE interactions
			ADD COLUMN IF NOT EXISTS email_message_id UUID
				REFERENCES email_messages(id) ON DELETE SET NULL
	`
	yield* sql`
		UPDATE interactions
		SET email_message_id = (metadata->>'emailMessageId')::uuid
		WHERE email_message_id IS NULL
		  AND metadata->>'emailMessageId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
	`
	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_interactions_email_message
			ON interactions (email_message_id)
			WHERE email_message_id IS NOT NULL
	`

	// Reading one company's history had no index to follow and sorted the
	// organisation's whole history to find the newest fifty.
	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_interactions_company_date
			ON interactions (organization_id, company_id, date DESC)
	`

	// The message itself. `inbox_id` is empty only for mail whose mailbox row
	// was removed outright, which nothing in the app does; such a message
	// belongs to nobody in particular and stays readable.
	yield* sql`
		CREATE POLICY private_mailbox_email_messages ON email_messages
			AS RESTRICTIVE
			TO app_user
			USING (
				inbox_id IS NULL
				OR EXISTS (
					SELECT 1 FROM inboxes i
					WHERE i.id = email_messages.inbox_id
					  AND (
					    i.is_private = false
					    OR i.owner_user_id = current_setting('app.current_user_id', true)
					  )
				)
			)
			WITH CHECK (
				inbox_id IS NULL
				OR EXISTS (
					SELECT 1 FROM inboxes i
					WHERE i.id = email_messages.inbox_id
					  AND (
					    i.is_private = false
					    OR i.owner_user_id = current_setting('app.current_user_id', true)
					  )
				)
			)
	`

	// The conversation. It is worth seeing when it holds a message worth
	// seeing — so a conversation of nothing but private mail disappears, while
	// a shared one stays, minus the private messages inside it. Its own row
	// carries a subject taken from the message it began with, which is reason
	// enough to hide the row itself and not only the messages under it.
	//
	// Writing a new one is left alone on purpose: a conversation is written
	// alongside the first message that belongs to it, and a rule here would
	// only refuse that pair depending on which half went in first.
	yield* sql`
		CREATE POLICY private_mailbox_email_thread_links ON email_thread_links
			AS RESTRICTIVE
			FOR SELECT
			TO app_user
			USING (
				EXISTS (
					SELECT 1 FROM email_messages m
					WHERE m.organization_id = email_thread_links.organization_id
					  AND m.thread_key = email_thread_links.external_thread_id
				)
			)
	`
	// Changing a conversation — closing it, marking it read — is refused the
	// same way, by matching no row. Removing one is covered too: nothing in the
	// app deletes a conversation today, and a rule written only for the actions
	// that exist stops holding the moment somebody adds one.
	for (const action of ['UPDATE', 'DELETE'] as const) {
		yield* sql`
			CREATE POLICY ${sql.literal(`private_mailbox_email_thread_links_${action.toLowerCase()}`)}
				ON email_thread_links
				AS RESTRICTIVE
				FOR ${sql.literal(action)}
				TO app_user
				USING (
					EXISTS (
						SELECT 1 FROM email_messages m
						WHERE m.organization_id = email_thread_links.organization_id
						  AND m.thread_key = email_thread_links.external_thread_id
					)
				)
		`
	}

	// The company's history. Only the entries about a message are in question;
	// everything else — calls, meetings, notes, research — is untouched.
	yield* sql`
		CREATE POLICY private_mailbox_timeline_activity ON timeline_activity
			AS RESTRICTIVE
			FOR SELECT
			TO app_user
			USING (
				entity_type <> 'email_message'
				OR EXISTS (
					SELECT 1 FROM email_messages m
					WHERE m.id = timeline_activity.entity_id
				)
			)
	`

	yield* sql`
		CREATE POLICY private_mailbox_interactions ON interactions
			AS RESTRICTIVE
			FOR SELECT
			TO app_user
			USING (
				email_message_id IS NULL
				OR EXISTS (
					SELECT 1 FROM email_messages m
					WHERE m.id = interactions.email_message_id
				)
			)
	`
})
