import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Freeze the names of the instruction templates that shaped a run, in the same
// order as template_ids. The names are captured at run time by the creator, who
// can read every template in their own stack — so they still display for a later
// viewer who can't read another member's personal template, and survive the
// template being renamed or deleted. Existing rows default to an empty set.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE research_runs
			ADD COLUMN template_names jsonb NOT NULL DEFAULT '[]'::jsonb
	`
})
