import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Postgres 16+ split role membership into separate ADMIN / INHERIT / SET
// options. The `CREATE ROLE` auto-grant in 0001_initial.ts hands the
// creator ADMIN but not SET, so `SET LOCAL ROLE app_user`/`app_service`
// is denied at runtime. Grant SET TRUE here; re-granting ADMIN would
// trip Postgres' "cannot be granted back to your own grantor" check.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`GRANT app_user TO CURRENT_USER WITH SET TRUE`
	yield* sql`GRANT app_service TO CURRENT_USER WITH SET TRUE`
})
