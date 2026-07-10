import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Why a run ended without usable data — a structured code behind a failed or
// no_reliable_data run (entity_mismatch, no_sources, internal_error, …) so the UI
// can show a localized reason and the eval can aggregate failure reasons, instead
// of the English sentence written into findings.error. Plain text like the
// existing entity_match column; the closed set is enforced in code via ReasonCode.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE research_runs
			ADD COLUMN IF NOT EXISTS reason_code text
	`
})
