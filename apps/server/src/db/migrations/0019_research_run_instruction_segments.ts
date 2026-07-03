import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// The resolved standing-instruction text segments that shape a run's phase-1
// prompt. Captured when the run is created so they stay fixed for the whole run
// even if the underlying templates later change. Existing rows default to an
// empty set.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE research_runs
			ADD COLUMN instruction_segments jsonb NOT NULL DEFAULT '[]'::jsonb
	`
})
