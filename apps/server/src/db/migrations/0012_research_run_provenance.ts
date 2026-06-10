import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Provenance for a research run: which instruction templates shaped it
// (template_ids, in resolution order) and a fingerprint of that resolved set —
// so a run can be traced back to the exact instructions used, even after those
// templates are later edited or deleted. template_ids is jsonb to match the
// table's other list columns; existing rows default to an empty set.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE research_runs
			ADD COLUMN template_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
			ADD COLUMN template_fingerprint text NOT NULL DEFAULT ''
	`
})
