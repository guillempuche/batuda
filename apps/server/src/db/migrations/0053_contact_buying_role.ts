import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// "Is this the decision maker" had one right answer in an owner-run business and
// no right answer anywhere else. In a factory the plant manager, purchasing and
// quality all sign; in a hospital the named head is reached through a
// procurement office that can stop everything without ever being the buyer. A
// yes/no forced all of that onto one person and lost the rest.
//
// `buying_role` says what part each person plays, one per row and as many rows
// as the company has, so several people holding a decision between them is
// simply what it looks like.
//
// The old column was also lying about its own shape: a boolean in the database
// and a nullable one in the model, so it already had three states while
// pretending to have two. "Nobody has said" is a real answer and is now spelled
// null rather than being indistinguishable from "no".
//
// Everyone previously marked as the decision maker becomes the economic buyer —
// the part that holds the budget, which is what that flag was being used to
// mean. Everyone else becomes null rather than being asserted not to decide,
// because a false there almost always meant "nobody looked", not "checked and
// no".
//
// expand-contract: pre-production clean break — this same release rewrites every
// reader and writer of the flag (the domain model and the typed client built
// from it, the contact routes and handlers, both assistant tools, the research
// write allowlist and the snapshot a run is shown, contact discovery and its
// output schema, the contacts eval, the seeds, and the web app's contact editor
// and research views). Nothing reads the dropped column once this deploy is out.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE contacts
			ADD COLUMN IF NOT EXISTS buying_role text
	`

	yield* sql`
		UPDATE contacts
		SET buying_role = 'economic_buyer'
		WHERE is_decision_maker IS TRUE AND buying_role IS NULL
	`

	yield* sql`ALTER TABLE contacts DROP COLUMN IF EXISTS is_decision_maker`
})
