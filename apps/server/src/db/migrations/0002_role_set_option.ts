import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Postgres 16+ split role membership into separate ADMIN / INHERIT / SET
// flags. The `CREATE ROLE` auto-grant in 0001_initial.ts hands the creator
// (here, the DATABASE_URL owner) ADMIN but NOT SET, so `SET LOCAL ROLE
// app_user` / `app_service` is denied at runtime — OrgMiddleware, the
// inbox-health-probe, and the calcom webhook handler all trip on it.
//
// 0001_initial.ts now issues the same GRANTs inline after CREATE ROLE, so
// fresh databases never hit this. This migration exists to fix the
// already-deployed Neon DB that was created against the older 0001.
//
// Idempotent: re-running `GRANT … WITH SET TRUE` against an already-set
// membership is a no-op.
//
// Keep `INHERIT FALSE`: the DATABASE_URL owner must NOT inherit
// `app_user`'s RLS-bound visibility by default. Code switches explicitly
// per transaction so the boundary stays auditable.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`GRANT app_user TO CURRENT_USER WITH ADMIN TRUE, INHERIT FALSE, SET TRUE`
	yield* sql`GRANT app_service TO CURRENT_USER WITH ADMIN TRUE, INHERIT FALSE, SET TRUE`
})
