import { Console, Effect } from 'effect'

import { listSessions } from '@batuda/auth'

import { acquireAuthAdapter } from '../lib/auth-adapter'
import { printTable } from '../lib/table'

export interface AuthSessionsInput {
	readonly email: string | undefined
}

/**
 * `pnpm cli auth sessions [--email]` — show every `"session"` row in
 * creation order, optionally scoped to a single user. Read-only, so no
 * cloud gate.
 */
export const authSessions = (input: AuthSessionsInput) =>
	Effect.gen(function* () {
		const { sessions } = yield* acquireAuthAdapter()

		const rows = yield* listSessions(sessions, input.email)

		if (rows.length === 0) {
			yield* Console.log('')
			yield* Console.log(
				input.email
					? `No sessions for ${input.email}.`
					: 'No sessions in this database.',
			)
			yield* Console.log('')
			return rows
		}

		yield* Console.log('')
		yield* printTable(
			[
				{ header: 'SessionId', width: 38, value: s => s.id },
				{ header: 'User', width: 34, value: s => s.userEmail },
				{ header: 'IP', width: 18, value: s => s.ipAddress ?? '—' },
				{ header: 'Expires', width: 0, value: s => s.expiresAt.toISOString() },
			],
			rows,
		)
		yield* Console.log('')
		yield* Console.log(`  ${rows.length} session(s)`)
		yield* Console.log('')
		return rows
	}).pipe(Effect.scoped)
