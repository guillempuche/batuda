import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { execIn, ROOT } from '../shell'

export const dbMigrate = execIn(ROOT, 'pnpm', 'db:migrate')

const MAILPIT_HTTP_URL =
	process.env['MAILPIT_HTTP_URL'] ?? 'http://localhost:8025'

// Drain every message Mailpit has captured so a re-seed starts from
// zero. Failures are logged but do not abort the reset — Mailpit is a
// dev-only service and a missing container shouldn't block local-DB
// work.
const clearMailpit = Effect.tryPromise({
	try: async () => {
		const res = await fetch(`${MAILPIT_HTTP_URL}/api/v1/messages`, {
			method: 'DELETE',
			signal: AbortSignal.timeout(2_000),
		})
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`)
		}
	},
	catch: e =>
		new Error(`mailpit clear: ${e instanceof Error ? e.message : String(e)}`),
}).pipe(
	Effect.catch(err =>
		Effect.logWarning(`mailpit not reachable, skipping clear (${err.message})`),
	),
)

export const dbReset = Effect.gen(function* () {
	yield* Effect.logInfo('Dropping public schema...')
	const sql = yield* SqlClient.SqlClient
	yield* sql`DROP SCHEMA IF EXISTS public CASCADE`
	yield* sql`CREATE SCHEMA public`

	yield* Effect.logInfo('Running migrations...')
	yield* dbMigrate

	yield* Effect.logInfo('Clearing Mailpit...')
	yield* clearMailpit

	yield* Effect.logInfo(
		'Database reset complete. Run `pnpm cli seed` to insert sample data.',
	)
})
