import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// A trust threshold for applying research findings without a human: a run's
// eligible proposals (a verified, machine-checkable value) whose confidence is
// at least this 0–100 score are written to the CRM automatically. Null (the
// default) keeps every finding waiting for review, so auto-apply is opt-in.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE user_research_policy
			ADD COLUMN IF NOT EXISTS auto_apply_min_confidence integer
	`
})
