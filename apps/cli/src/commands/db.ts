import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { execIn, ROOT } from '../shell'
import { seed, seedIdentities } from './seed'

export const dbMigrate = execIn(ROOT, 'pnpm', 'db:migrate')

export const dbReset = Effect.gen(function* () {
	yield* Effect.logInfo('Dropping public schema...')
	const sql = yield* SqlClient.SqlClient
	yield* sql`DROP SCHEMA IF EXISTS public CASCADE`
	yield* sql`CREATE SCHEMA public`

	yield* Effect.logInfo('Running migrations...')
	yield* dbMigrate

	// Identities first so the CRM seed can stamp organization_id on every
	// row from the resolved org id (default: the taller demo org).
	yield* Effect.logInfo('Seeding identities...')
	yield* seedIdentities

	yield* Effect.logInfo('Seeding (full)...')
	yield* seed('full')

	yield* Effect.logInfo('Database reset complete.')
})
