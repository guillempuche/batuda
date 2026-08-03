import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Stop recording "where this lead came from" in one word.
//
// The column held one of a handful of words — firecrawl, referral, linkedin,
// manual — meant to say how a company reached the CRM. It never earned its keep:
// nothing filtered or grouped by it, it appeared in exactly one panel, and it had
// already drifted past its own list, since the research screens write "research"
// into it, which was never one of the values it documented.
//
// What it was reaching for is answered better elsewhere. Research records where
// each individual fact came from, per field, with the page and the run that read
// it — so "where did this come from" is a question the row can answer about any
// value on it, rather than one word about the whole company.
//
// expand-contract: pre-production clean break. This same release removes every
// reader and writer of companies.source — the model, both route inputs, both
// agent tools, the research write allowlist, the company panel and the seeds —
// so nothing is left asking for it once this is out.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`ALTER TABLE companies DROP COLUMN IF EXISTS source`
})
