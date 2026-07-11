import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// When a human confirmed this company is a real lead worth working, and who did.
// Kept separate from the pipeline `status` on purpose: a company can be a
// verified lead at any stage, and a research-discovered company can sit
// unverified until someone vouches for it. Nullable = not yet verified; plain
// text for the verifier (a Better Auth user id) with no foreign key, since the
// auth stack owns the user table — same convention as companies.owner_id.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE companies
			ADD COLUMN IF NOT EXISTS verified_at timestamptz,
			ADD COLUMN IF NOT EXISTS verified_by text
	`
})
