import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// What a salesperson needs to know about a company before picking up the phone,
// and where each piece of it came from.
//
// `account_brief` is the running written summary of the account, in markdown.
// Both a person and the research pipeline write it, so two more columns record
// who touched it last: `brief_updated_by` is the id of the person who edited it
// (null while nobody has, which is what makes it safe to replace wholesale), and
// `brief_updated_at` is when. Once a person has edited it, later research is
// added to the end instead of replacing what they wrote.
//
// `field_provenance` answers "where did this come from?" for the individual
// facts on the row — for each column, the page it was read from, the run that
// read it, how sure that run was, and the date it was true as of. Kept as one
// json object rather than a table because it is always read whole, with the row.
//
// `last_enriched_at` is when research findings were last accepted onto this row.
//
// The three `fit_*` columns hold the judgement of whether this company is worth
// selling to: an overall verdict, the per-criterion checks behind it, and any
// points where two sources disagreed. All nullable — a company nobody has
// researched simply has none of this.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE companies
			ADD COLUMN IF NOT EXISTS account_brief text,
			ADD COLUMN IF NOT EXISTS brief_updated_by text,
			ADD COLUMN IF NOT EXISTS brief_updated_at timestamptz,
			ADD COLUMN IF NOT EXISTS last_enriched_at timestamptz,
			ADD COLUMN IF NOT EXISTS field_provenance jsonb,
			ADD COLUMN IF NOT EXISTS fit_verdict text,
			ADD COLUMN IF NOT EXISTS fit_checks jsonb,
			ADD COLUMN IF NOT EXISTS fit_conflicts jsonb
	`
})
