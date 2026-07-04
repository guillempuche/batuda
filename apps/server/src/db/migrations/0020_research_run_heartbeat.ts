import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// A liveness timestamp, refreshed periodically while a run is active. A stale
// beat — not the run's age — is what marks a run as crashed, so a legitimately
// long run is never mistaken for a dead one. Rows without a beat (not yet
// started, or predating this column) fall back to the age check.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE research_runs
			ADD COLUMN heartbeat_at timestamptz
	`
})
