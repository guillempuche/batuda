import { Console, Effect } from 'effect'

import { resetPassword } from '@engranatge/auth'

import { acquireAuthAdapter } from '../lib/auth-adapter'
import { confirmCloud } from '../lib/confirm-cloud'

export interface AuthResetPasswordInput {
	readonly email: string
	readonly password: string
}

/**
 * `pnpm cli auth reset-password <email>` — overwrite the credential row in
 * `"account"` with a freshly hashed password. Works for both password-based
 * users and those created passwordless via `auth invite` (the `setPassword`
 * port upserts, so it re-creates the row for the latter).
 */
export const authResetPassword = (input: AuthResetPasswordInput) =>
	Effect.gen(function* () {
		yield* confirmCloud('auth reset-password')

		const { users } = yield* acquireAuthAdapter()

		yield* resetPassword(users, input.email, input.password)

		yield* Console.log('')
		yield* Console.log(`  \u2713 Password reset for ${input.email}`)
		yield* Console.log('')
	}).pipe(Effect.scoped)
