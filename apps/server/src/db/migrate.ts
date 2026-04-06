import { apiKey } from '@better-auth/api-key'
import { NodeRuntime } from '@effect/platform-node'
import { getMigrations } from 'better-auth/db/migration'
import { admin, bearer, openAPI } from 'better-auth/plugins'
import { Effect } from 'effect'
import { PostgresDialect } from 'kysely'
import pg from 'pg'

import { MigratorLive } from './migrator'

// Better Auth migration config — keep plugins and user fields
// in sync with src/lib/auth.ts
const authMigrate = Effect.promise(async () => {
	const pool = new pg.Pool({
		connectionString: process.env['DATABASE_URL'],
	})
	const { runMigrations } = await getMigrations({
		database: {
			dialect: new PostgresDialect({ pool }),
			type: 'postgres',
		},
		user: {
			additionalFields: {
				isAgent: {
					type: 'boolean',
					required: false,
					defaultValue: false,
				},
			},
		},
		plugins: [openAPI(), bearer(), admin(), apiKey()],
	})
	await runMigrations()
	await pool.end()
})

const program = Effect.gen(function* () {
	yield* Effect.log('Running CRM migrations...')
	yield* Effect.provide(Effect.void, MigratorLive)
	yield* Effect.log('CRM migrations complete')

	yield* Effect.log('Running Better Auth migrations...')
	yield* authMigrate
	yield* Effect.log('Better Auth migrations complete')
})

NodeRuntime.runMain(program)
