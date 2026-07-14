import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// This table backed a structured-extract cache that no longer exists in the
// code — nothing reads or writes it anymore. Drop it so the database schema
// matches the codebase. Dropping the table drops its index along with it.
//
// expand-contract: pre-production clean break — this same release removes the
// table's only users (the extract-cache provider, which nothing consumes at
// runtime, and the hourly retention sweep). No instance queries it on the request
// path, and a stale instance's best-effort sweep already degrades on a missing
// table, so dropping it in this deploy is safe.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`DROP TABLE IF EXISTS extraction_cache`
})
