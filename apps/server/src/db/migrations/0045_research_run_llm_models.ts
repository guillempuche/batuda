import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Which model answered how many of a run's calls, and the removal of an index
// nothing ever searched by.
//
// A tier is configured with two models: a first choice, and a second one for
// when the first falters. Until now a run recorded only what it was configured
// with, so a run carried out largely by the second model was filed under the
// name of the first — and the quality of the two is not the same. `llm_models`
// counts the calls each model answered, so a run says who did the work.
//
// It is counted apart from the cost figures because those are added up to reach
// what a run cost; a second entry describing the same spend would charge the
// run twice.
//
// The index on `sources.domain` is dropped: sources are looked up by their
// address or their id, never by site, so the index earned nothing and cost a
// write on every page a run records.
//
// expand-contract: pre-production, no backward-compatibility guarantee — the new
// column defaults to empty so rows written before this release read as "not
// recorded", and no query in this release or any earlier one searches sources by
// domain.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE research_runs
			ADD COLUMN IF NOT EXISTS llm_models jsonb NOT NULL DEFAULT '{}'::jsonb
	`

	yield* sql`DROP INDEX IF EXISTS sources_domain_idx`
})
