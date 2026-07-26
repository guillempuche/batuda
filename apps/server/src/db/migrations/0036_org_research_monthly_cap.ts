import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// The monthly ceiling on what research may spend at paid vendors belongs to the
// company, not to each person in it. The vendor plans are bought once for the
// whole company and billed to it, so a ceiling held per person let every person
// spend the whole month's money on their own — five colleagues meant five times
// the intended bill.
//
// A company with no row here spends up to the figure shipped in configuration.
// A company that needs more gets a row of its own, still bounded by the system
// ceiling so a single setting cannot authorise unlimited spending.
//
// The ledger gains an index on company and date because the ceiling is checked
// by adding up this month's spending for the whole company, and that sum is
// taken while every other paid call in the company waits behind it. The old
// company-only index is covered by the new one.
//
// expand-contract: pre-production clean break — this same release moves the
// ceiling to this table and takes it off every surface that read the personal
// one, so nothing is left reading the dropped column.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE TABLE IF NOT EXISTS organization_research_policy (
			organization_id        text PRIMARY KEY,
			paid_monthly_cap_cents int NOT NULL,
			updated_at             timestamptz NOT NULL DEFAULT now()
		)
	`

	yield* sql`ALTER TABLE organization_research_policy ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE organization_research_policy FORCE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY org_isolation_organization_research_policy
			ON organization_research_policy
			TO app_user
			USING (organization_id = current_setting('app.current_org_id', true))
			WITH CHECK (organization_id = current_setting('app.current_org_id', true))
	`

	yield* sql`
		CREATE INDEX IF NOT EXISTS research_paid_spend_org_at_idx
			ON research_paid_spend(organization_id, at DESC)
	`
	yield* sql`DROP INDEX IF EXISTS idx_research_paid_spend_org`

	yield* sql`
		ALTER TABLE user_research_policy
			DROP COLUMN IF EXISTS paid_monthly_cap_cents
	`
})
