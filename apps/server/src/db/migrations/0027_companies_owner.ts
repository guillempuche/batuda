import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Who owns this lead — the org member responsible for working it through the
// pipeline. Nullable so a company can sit unassigned, and plain text (a Better
// Auth user id) with no foreign key because the auth stack owns the user table
// and runs its own migrations. Same shape as tasks.assignee_id. The partial
// index serves the per-owner "my leads" reads.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE companies
			ADD COLUMN IF NOT EXISTS owner_id text
	`

	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_companies_owner
			ON companies (organization_id, owner_id)
			WHERE owner_id IS NOT NULL
	`
})
