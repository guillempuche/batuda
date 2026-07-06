import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// A research run that fetched no page fails closed to `no_reliable_data` rather
// than reporting success with ungrounded findings. The status check has to admit
// that new terminal value, so the original inline check is replaced.
//
// expand-contract: pre-production, no backward-compatibility guarantee — the old
// check is dropped outright, a clean break like every schema change here.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE research_runs
			DROP CONSTRAINT IF EXISTS research_runs_status_check,
			ADD CONSTRAINT research_runs_status_check
				CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'deleted', 'no_reliable_data'))
	`
})
