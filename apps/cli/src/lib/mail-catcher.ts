import { Config, Effect } from 'effect'

/**
 * Throw away every message the dev mail catcher is holding.
 *
 * Rebuilding the sample data clears the email tables, so mail the catcher kept
 * from an earlier run no longer matches what the database says — and the mail
 * worker, which reads from the catcher, would carry it into the fresh data.
 * Both `db reset` and `seed` clear it for that reason.
 *
 * A catcher that is down, or an unset address, is logged and skipped: this is a
 * convenience for local work, not something worth failing a seed over.
 */
export const clearMailCatcher = Effect.gen(function* () {
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
