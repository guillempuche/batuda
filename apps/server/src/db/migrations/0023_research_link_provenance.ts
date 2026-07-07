import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// A contact or company that a research run wrote back keeps a trail to the
// evidence behind it. The citations the run attached to that suggestion —
// which source each claim came from — are stored here on the link between the
// run and the row, so the applied row keeps a resolvable pointer to its
// evidence (the run, its date, and the source URLs) even after the bulkier run
// transcript is later pruned for retention. How that trail is worded for a
// reader is left to the presentation layer.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE research_links
			ADD COLUMN IF NOT EXISTS citations jsonb NOT NULL DEFAULT '[]'::jsonb
	`
})
