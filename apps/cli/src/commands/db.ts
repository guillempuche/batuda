import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { execIn, ROOT } from '../shell'

export const dbMigrate = execIn(ROOT, 'pnpm', 'db:migrate')

// The mail catcher is deliberately left alone here. One catcher serves every
// worktree on the machine, and it offers no way to empty a single mailbox — only
// to wipe everything, which destroys mail another worktree's tests are waiting
// on, or to delete an account, which breaks the connection every running server
// and mail worker holds open and cannot be undone through its API. Tests no
// longer need a clean catcher: each one looks for its own message by name.
export const dbReset = Effect.gen(function* () {
	yield* Effect.logInfo('Dropping public schema...')
	const sql = yield* SqlClient.SqlClient
	yield* sql`DROP SCHEMA IF EXISTS public CASCADE`
	yield* sql`CREATE SCHEMA public`

	yield* Effect.logInfo('Running migrations...')
	yield* dbMigrate

	yield* Effect.logInfo(
		'Database reset complete. Run `pnpm cli seed` to insert sample data.',
	)
})
