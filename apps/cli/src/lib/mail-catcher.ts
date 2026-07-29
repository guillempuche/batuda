import { Config, Console, Effect } from 'effect'

/**
 * Empty the dev mail catcher — every mailbox, for every checkout on this
 * machine.
 *
 * There is no way to empty a single mailbox: the one narrower thing the catcher
 * offers is deleting an account, which cuts the connection every running server
 * and mail worker holds open and cannot be put back from the catcher itself.
 *
 * So this is a command to run on purpose, never a step folded into another one.
 * Nothing needs it to pass: each test finds its own messages by name.
 */
export const emailClear = Effect.gen(function* () {
	const url = yield* Config.string('MAIL_CATCHER_HTTP_URL')
	yield* Console.log(
		'Emptying the mail catcher. It is shared, so this discards captured mail for every checkout on this machine.',
	)
	yield* Effect.tryPromise({
		try: async () => {
			const response = await fetch(`${url}/api/mail/purge`, {
				method: 'POST',
				signal: AbortSignal.timeout(5_000),
			})
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`)
			}
		},
		catch: error =>
			new Error(error instanceof Error ? error.message : String(error)),
	})
	yield* Console.log(`✓ Mail catcher emptied (${url}).`)
})
