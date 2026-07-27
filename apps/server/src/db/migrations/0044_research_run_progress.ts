import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// How many rounds of work a run has got through, refreshed while it works. A run
// takes minutes, and until it reaches a checkpoint the only thing that moves on
// its row is the liveness beat — so anyone watching cannot tell a run that is
// making progress from one that is stuck. Kept apart from `phase`, which records
// the last checkpoint a restart would resume from and must not move until that
// checkpoint is written. Null until the first round, so "nothing reported yet"
// stays distinct from "reported none".

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE research_runs
			ADD COLUMN IF NOT EXISTS progress_steps int
	`
})
