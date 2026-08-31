import { apiKey } from '@better-auth/api-key'
import { oauthProvider } from '@better-auth/oauth-provider'
import { NodeRuntime } from '@effect/platform-node'
import type { BetterAuthOptions } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { admin, bearer, jwt, openAPI, organization } from 'better-auth/plugins'
import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { PostgresDialect } from 'kysely'
import pg from 'pg'

import { PgLive } from './client'
import { MigratorLive } from './migrator'

/**
 * Everything Better Auth reads when working out what its tables should look
 * like: the extra fields on its own tables, and the plugins that bring tables
 * of their own. Separate from the connection because the shape is the same on
 * every run, and because it is compared against the config the running server
 * builds — see `migrate.test.ts`.
 *
 * These fields are declared twice on purpose: here, so the migrator creates the
 * columns, and in the shared config, so the server knows they exist. Adding one
 * here alone makes a column nothing reads; adding it there alone makes the
 * server expect a column that was never created. The test fails on either.
 */
export const betterAuthSchemaConfig = {
	user: {
		additionalFields: {
			isAgent: {
				type: 'boolean',
				required: false,
				defaultValue: false,
			},
			locale: {
				type: 'string',
				required: false,
				input: false,
			},
			passwordOptOut: {
				type: 'boolean',
				required: false,
				defaultValue: false,
			},
		},
	},
	// `organization()` here so Better Auth generates the `organization` /
	// `member` / `invitation` tables alongside the rest.
	plugins: [
		openAPI(),
		bearer(),
		admin(),
		organization(),
		apiKey(),
		// Generates the OAuth provider tables (oauthClient, oauthAccessToken,
		// oauthRefreshToken, oauthConsent) plus the jwt plugin's jwks table,
		// backing the OAuth MCP path. loginPage/consentPage are runtime-only;
		// the values don't affect schema generation.
		jwt(),
		oauthProvider({
			loginPage: 'http://localhost/login',
			consentPage: 'http://localhost/consent',
		}),
	],
} satisfies Pick<BetterAuthOptions, 'user' | 'plugins'>

const authMigrate = Effect.promise(async () => {
	const pool = new pg.Pool({
		connectionString: process.env['DATABASE_URL'],
	})
	const { runMigrations } = await getMigrations({
		database: {
			dialect: new PostgresDialect({ pool }),
			type: 'postgres',
		},
		...betterAuthSchemaConfig,
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

// A word written in Chinese, Russian, Greek or Hindi, asked of the database as a
// run of letters. Under a database built with the `C` locale, "letter" means a-z
// and nothing else, so this comes back empty.
const A_WORD_IN_EVERY_ALPHABET = '北京 Логистика Μεταφορές निर्माण'

// Refuse to migrate a database that cannot tell a letter from punctuation outside
// a-z.
//
// The locale a database is built with cannot be changed afterwards — it is fixed
// at CREATE DATABASE — so the only safe moment to find out is before anything is
// written. Under a `C` locale, migrations that fold a name by asking Postgres for
// its letters quietly reduce every non-Latin one to nothing, and a row that folds
// to nothing is dropped: the companies simply never get their trade, and no error
// is raised at any point.
const refuseUnlessEveryAlphabetReads = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	const rows = yield* sql<{
		readable: string
		ctype: string
	}>`SELECT regexp_replace(${A_WORD_IN_EVERY_ALPHABET}, '[^[:alnum:]]+', '', 'g') AS readable,
			(SELECT datctype FROM pg_database WHERE datname = current_database()) AS ctype`
	const readable = rows[0]?.readable ?? ''
	const ctype = rows[0]?.ctype ?? 'unknown'
	if (readable === '') {
		return yield* Effect.die(
			new Error(
				`Refusing to migrate a database that cannot read letters outside a-z ` +
					`(LC_CTYPE is "${ctype}"). Every company name, trade and search term ` +
					`written in another alphabet would fold to nothing and be dropped ` +
					`without an error. A database's locale is fixed when it is created, so ` +
					`this one has to be rebuilt: CREATE DATABASE … LOCALE 'en_US.utf8' ` +
					`TEMPLATE template0.`,
			),
		)
	}
	yield* Effect.log(`Database reads every alphabet (LC_CTYPE "${ctype}")`)
})

// Skipped, connection layer and all, when no database is named: building the layer
// is itself what reads the setting, so asking first has to happen out here. The
// migration steps below surface a missing database on their own.
const refuseUnreadableCollation = Effect.suspend(() =>
	process.env['DATABASE_URL']
		? Effect.provide(refuseUnlessEveryAlphabetReads, PgLive)
		: Effect.void,
)

// Better Auth migrations run first so the CRM migrations can reference Better
// Auth tables — 0001_initial alters `member`, which has to exist by the time
// that ALTER TABLE fires.
const program = Effect.gen(function* () {
	yield* logMigrationTarget
	yield* refuseUnreadableCollation
	yield* Effect.log('Running Better Auth migrations...')
	yield* authMigrate
	yield* Effect.log('Better Auth migrations complete')

	yield* Effect.log('Running CRM migrations...')
	yield* Effect.provide(Effect.void, MigratorLive)
	yield* Effect.log('CRM migrations complete')
})

NodeRuntime.runMain(program)
