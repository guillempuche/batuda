import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// The starter preset catalog was removed in the corresponding code cleanup.
// New templates no longer populate source_preset_id, and no code reads it.
// Drop the now-unused column so the schema matches the codebase.
//
// Note: modifying 0008_instruction_templates.ts directly would be wrong because
// that migration has already run on production databases. A dedicated forward
// migration is the safe way to remove the leftover column.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE instruction_templates
		DROP COLUMN IF EXISTS source_preset_id
	`
})
