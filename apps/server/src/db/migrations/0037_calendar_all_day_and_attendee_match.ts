import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Two things an invitation already tells us that had nowhere to be recorded.
//
// `all_day` marks an entry that covers whole days rather than a slot in the
// afternoon. Such an invitation carries dates and no clock times, so its closing
// date is stored as the moment the day ends — a single day runs midnight to
// midnight. Without the flag those entries are indistinguishable from a meeting
// that happens to last exactly 24 hours.
//
// On the attendee rows, `match_status` records what was decided when an email
// address was compared against the people on file: it matched somebody, it
// matched the company but no particular person, several people were possible, or
// nobody was. That judgement is made on every ingest and was being thrown away,
// leaving the interface able to say only "known" or "not known". When several
// people were possible, `match_candidates` keeps who they were, so the choice can
// be offered rather than guessed at.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE calendar_events
			ADD COLUMN IF NOT EXISTS all_day boolean NOT NULL DEFAULT false
	`

	// The check rides along with the column so only the four decisions the
	// matcher can actually reach are storable, and a typo cannot quietly become a
	// fifth kind of answer. A row nothing has judged yet holds null, which a
	// check on a nullable column allows.
	yield* sql`
		ALTER TABLE calendar_event_attendees
			ADD COLUMN IF NOT EXISTS match_status text
				CHECK (match_status IN ('matched', 'company_only', 'ambiguous', 'no_match')),
			ADD COLUMN IF NOT EXISTS match_candidates jsonb
	`
})
