import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { execIn, ROOT } from '../shell'
import { seed } from './seed'

export const dbMigrate = execIn(ROOT, 'pnpm', 'db:migrate')

export const dbReset = Effect.gen(function* () {
	yield* Effect.logInfo('Truncating all tables...')
	const sql = yield* SqlClient.SqlClient
	yield* sql`TRUNCATE companies CASCADE`
	yield* sql`TRUNCATE products CASCADE`
	yield* sql`TRUNCATE pages CASCADE`

	yield* Effect.logInfo('Running migrations...')
	yield* dbMigrate

	yield* Effect.logInfo('Seeding...')
	yield* seed

	yield* Effect.logInfo('Database reset complete.')
})
