import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Stop recording who last wrote a company's account notes.
//
// These two columns existed to answer one question: may research replace the
// notes, or must it add underneath? A person writing put their id here, and an
// apply read it and appended rather than overwriting. That rule is gone — the
// notes are one shared page that a person, an agent and a research run all
// rewrite, each replacing what the last one left — so nothing reads the answer
// any more.
//
// Nothing is kept in their place. The notes say what the last writer wrote, and
// `updated_at` says when the row last changed; a record of who wrote which
// version would mean storing the versions, which the notes deliberately do not.
//
// expand-contract: pre-production clean break. This same release removes every
// reader and writer of both columns — the model, the shared author helper and
// its two call sites, the research apply statement, and the company page's
// attribution line — so nothing is left asking for them once this is out.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE companies
			DROP COLUMN IF EXISTS brief_updated_by,
			DROP COLUMN IF EXISTS brief_updated_at
	`
})
