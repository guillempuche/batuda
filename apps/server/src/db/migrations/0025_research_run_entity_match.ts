import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// How strongly a completed run's fetched evidence was about the company it
// researched: 'strong' | 'weak' | null. A weak run keeps its brief but withholds
// CRM writes and is flagged low-confidence; the verdict is stored so that
// handling survives a resume after a crash. Null means the run was not
// entity-gated (a scan or freeform run whose findings are about third parties).

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE research_runs
			ADD COLUMN IF NOT EXISTS entity_match text
	`
})
