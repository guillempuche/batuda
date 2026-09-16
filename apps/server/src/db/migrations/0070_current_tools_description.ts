import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Migration 0069 declared `current_tools` on every organisation it copied a
// value for, but gave the declaration no `description` — the sentence a
// research run's first phase reads to know what to look for. Without one, a
// run fills the key with anything tool-shaped it finds on a page, including
// the products the company itself makes or sells.
//
// Only the row 0069 created is touched, and only while nobody has written a
// description of their own onto it since: `created_by` names the migration,
// and the `IS NULL` guard is what makes a second run of this file harmless.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		UPDATE research_attributes
		SET description = 'Software and systems the company says it uses in its own work, named on its pages — never the products it makes or sells.',
			updated_at = now()
		WHERE created_by = 'migration-0069' AND description IS NULL
	`
})
