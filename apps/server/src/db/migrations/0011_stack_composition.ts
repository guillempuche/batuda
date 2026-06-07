import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// A user's default instruction stack can either REPLACE the org default (the
// original behavior) or EXTEND it — resolving as the live org default followed
// by the user's own additions. `composition` records which. It is meaningful
// only for a user-owned stack; the org default is always the base, so its value
// is ignored. Existing stacks default to 'replace', preserving today's
// resolution.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE agent_default_stacks
			ADD COLUMN composition text NOT NULL DEFAULT 'replace'
	`
	yield* sql`
		ALTER TABLE agent_default_stacks
			ADD CONSTRAINT agent_default_stacks_composition_valid
			CHECK (composition IN ('replace', 'extend'))
	`
})
