import { Config, Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { execIn, ROOT } from '../shell'

export const dbMigrate = execIn(ROOT, 'pnpm', 'db:migrate')

// Purge every message the mail catcher has captured so a re-seed starts from
// zero. The endpoint is MAIL_CATCHER_HTTP_URL (see .env.example; `pnpm cli
// setup` copies it) — no hardcoded fallback. Failures (catcher down, or the
// var unset) are logged but don't abort the reset; it's a dev-only convenience.
const clearCatcher = Effect.gen(function* () {
	const url = yield* Config.string('MAIL_CATCHER_HTTP_URL')
	yield* Effect.tryPromise({
		try: async () => {
			const res = await fetch(`${url}/api/mail/purge`, {
				method: 'POST',
				signal: AbortSignal.timeout(2_000),
			})
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`)
			}
		},
		catch: e => new Error(e instanceof Error ? e.message : String(e)),
	})
}).pipe(
	Effect.catch(() =>
		Effect.logWarning(
			'mail catcher purge skipped (catcher unreachable or MAIL_CATCHER_HTTP_URL unset)',
		),
	),
)

export const dbReset = Effect.gen(function* () {
	yield* Effect.logInfo('Dropping public schema...')
	const sql = yield* SqlClient.SqlClient
	yield* sql`DROP SCHEMA IF EXISTS public CASCADE`
	yield* sql`CREATE SCHEMA public`

	yield* Effect.logInfo('Running migrations...')
	yield* dbMigrate

	yield* Effect.logInfo('Purging mail catcher...')
	yield* clearCatcher

	yield* Effect.logInfo(
		'Database reset complete. Run `pnpm cli seed` to insert sample data.',
	)
})
