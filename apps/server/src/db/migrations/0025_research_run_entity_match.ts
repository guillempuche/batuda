import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// How strongly a completed run's fetched evidence was about the company it
// researched: 'strong' | 'weak' | 'absent' | null. Only a strong match proceeds;
// a weak or absent run fails closed to no_reliable_data, and the verdict is stored
// so a reviewer can tell the two apart. Null means the run was not entity-gated
// (a scan or freeform run whose findings are about third parties).

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE research_runs
			ADD COLUMN IF NOT EXISTS entity_match text
	`
})
