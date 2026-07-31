import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// A company could say where each of its facts came from; a person could not.
// All a contact carried was which runs had touched the row at all — useful for
// "who looked at this", useless for "is this job title still true?".
//
// People are the fastest-decaying thing held here. An association's board turns
// over every year, hospitality churns managers, and somebody's title from
// eighteen months ago is worse than no title: it is a wrong one, quoted
// confidently in an opening line.
//
// So a person gets the same per-field record a company has — for each field, the
// page it was read on, the run that read it, how sure that run was, and the date
// it was true as of. The as-of date is the part that matters here and comes free
// with the shape: the record already carries one, and nothing was writing it
// because there was nowhere to put it.
//
// This sits beside the run-level trail, which keeps answering a different
// question — "which runs have touched this person" — rather than replacing it.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE contacts
			ADD COLUMN IF NOT EXISTS field_provenance jsonb
	`
})
