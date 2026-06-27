import { apiKey } from '@better-auth/api-key'
import { oauthProvider } from '@better-auth/oauth-provider'
import { NodeRuntime } from '@effect/platform-node'
import { getMigrations } from 'better-auth/db/migration'
import { admin, bearer, jwt, openAPI, organization } from 'better-auth/plugins'
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
				passwordOptOut: {
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
			// Generates the OAuth provider tables (oauthClient, oauthAccessToken,
			// oauthRefreshToken, oauthConsent) plus the jwt plugin's jwks table,
			// backing the OAuth MCP path. loginPage/consentPage are runtime-only;
			// the values don't affect schema generation. Keep in sync with
			// src/lib/auth.ts.
			jwt(),
			oauthProvider({
				loginPage: 'http://localhost/login',
				consentPage: 'http://localhost/consent',
			}),
		],
	})
	await runMigrations()
	await pool.end()
})

// Echo which database each run targets (flagging a local host) so a stray
// `db:migrate` can't quietly hit the wrong one, and refuse a pooled endpoint
// outright — migrating through the pooler half-applies and corrupts.
const isLocalHost = (host: string): boolean =>
	host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')

// Neon's pooled endpoint (PgBouncer, transaction mode) drops the advisory
// locks + cross-statement transactions the migrators hold, so migrating
// through it half-applies. Runtime uses the pooled URL; migrations must use
// the direct one (DATABASE_URL_UNPOOLED in prod, plain DATABASE_URL wherever
// no pooler exists).
const isPooledHost = (host: string): boolean =>
	host.includes('-pooler') || host.includes('pgbouncer')

const logMigrationTarget = Effect.gen(function* () {
	const raw = process.env['DATABASE_URL']
	if (!raw) return
	let host = 'unknown'
	let database = 'unknown'
	try {
		const url = new URL(raw)
		host = url.hostname
		database = url.pathname.replace(/^\//, '') || 'unknown'
	} catch {
		// a malformed URL is surfaced by the migration steps below
	}
	if (isPooledHost(host)) {
		return yield* Effect.die(
			new Error(
				`Refusing to migrate through a pooled connection (${host}). Point ` +
					`DATABASE_URL at the direct/unpooled endpoint — the pooler breaks ` +
					`the locks and transactions migrations rely on.`,
			),
		)
	}
	yield* Effect.log(
		`Migration target: "${database}" on ${host}${isLocalHost(host) ? ' (local)' : ''}`,
	)
})

// Better Auth migrations run first so the CRM migration (0001_initial)
// can reference Better Auth tables — specifically the FK from
// member.primary_inbox_id → inboxes(id) needs the `member` table to
// already exist when the ALTER TABLE fires.
const program = Effect.gen(function* () {
	yield* logMigrationTarget
	yield* Effect.log('Running Better Auth migrations...')
	yield* authMigrate
	yield* Effect.log('Better Auth migrations complete')

	yield* Effect.log('Running CRM migrations...')
	yield* Effect.provide(Effect.void, MigratorLive)
	yield* Effect.log('CRM migrations complete')
})

NodeRuntime.runMain(program)
