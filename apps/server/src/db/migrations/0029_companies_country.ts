import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Which country a company is in — the global geographic segment the CRM filters
// and groups by. An ISO 3166-1 alpha-2 code (e.g. US, ES, DE), nullable until
// known. Replaces the old Spain-only `region` (three autonomous-community codes),
// which could not represent a company anywhere else in the world. The matching
// column on a research run records the country that run was about, so applying a
// run's findings can stamp it onto the company.

// expand-contract: pre-production clean break — this same release removes every
// reader of `companies.region` (the domain model, the API, the research pipeline,
// and the web app all move to `country` in the one change), so no running instance
// still reads the old column during the deploy.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE companies
			ADD COLUMN IF NOT EXISTS country text,
			DROP COLUMN IF EXISTS region
	`

	yield* sql`
		ALTER TABLE research_runs
			ADD COLUMN IF NOT EXISTS country text
	`
})
