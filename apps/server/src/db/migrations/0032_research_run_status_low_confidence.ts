import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// A research run that succeeds but is thin — a weak entity match, a barely-grounded
// profile, or a scan vetted against a single source — flips to a distinct terminal
// status, `succeeded_low_confidence`, so an automation can gate on `status` alone
// instead of inspecting every run. The status check has to admit that new value.
//
// expand-contract: pre-production, no backward-compatibility guarantee — the old
// check is dropped outright, a clean break like every schema change here.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE research_runs
			DROP CONSTRAINT IF EXISTS research_runs_status_check,
			ADD CONSTRAINT research_runs_status_check
				CHECK (status IN ('queued', 'running', 'succeeded', 'succeeded_low_confidence', 'failed', 'cancelled', 'deleted', 'no_reliable_data'))
	`
})
