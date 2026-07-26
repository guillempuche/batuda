import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Three columns on the record of paid research nothing ever read back.
//
// `result_hash` and `result_data` were meant to cache what a paid lookup
// returned so the same question would not be bought twice; only nulls were ever
// written, and the run itself already stores its findings. `approved_by` was
// meant to name whoever waved a charge through, but the row already records
// whether it was approved automatically, and nothing ever asked who.
//
// expand-contract: pre-production, no backward-compatibility guarantee — nothing
// in this release or any earlier one reads these three columns, and the only
// writer was seed data, which stops writing them in this same change.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE research_paid_spend
			DROP COLUMN IF EXISTS result_hash,
			DROP COLUMN IF EXISTS result_data,
			DROP COLUMN IF EXISTS approved_by
	`
})
