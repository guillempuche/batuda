import { apiKey } from '@better-auth/api-key'
import { NodeRuntime } from '@effect/platform-node'
import { getMigrations } from 'better-auth/db/migration'
import { admin, bearer, openAPI, organization } from 'better-auth/plugins'
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
		// `organization()` here so Better Auth's CLI generates the
		// `organization` / `member` / `invitation` tables alongside the rest.
		// `member.primary_inbox_id` is a Batuda extension used to record each
		// member's default From identity in this org.
		plugins: [
			openAPI(),
			bearer(),
			admin(),
			organization({
				schema: {
					member: {
						additionalFields: {
							primaryInboxId: {
								type: 'string',
								required: false,
								fieldName: 'primary_inbox_id',
							},
						},
					},
				},
			}),
			apiKey(),
		],
	})
	await runMigrations()
	await pool.end()
})

// Better Auth migrations run first so the CRM migration (0001_initial)
// can reference Better Auth tables — specifically the FK from
// member.primary_inbox_id → inboxes(id) needs the `member` table to
// already exist when the ALTER TABLE fires.
const program = Effect.gen(function* () {
	yield* Effect.log('Running Better Auth migrations...')
	yield* authMigrate
	yield* Effect.log('Better Auth migrations complete')

	yield* Effect.log('Running CRM migrations...')
	yield* Effect.provide(Effect.void, MigratorLive)
	yield* Effect.log('CRM migrations complete')
})

NodeRuntime.runMain(program)
