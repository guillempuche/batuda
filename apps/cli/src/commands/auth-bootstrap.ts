import { Console, Effect } from 'effect'

import { bootstrapFirstAdmin } from '@batuda/auth'

import { acquireAuthAdapter } from '../lib/auth-adapter'
import { confirmCloud } from '../lib/confirm-cloud'

export interface AuthBootstrapInput {
	readonly email: string
	readonly name: string
	readonly password: string
}

/**
 * `pnpm cli auth bootstrap` — create the very first admin user.
 *
 * Refuses if any row exists in `"user"`. The cloud gate re-prompts for the
 * DB hostname when running under `--env cloud`; local runs pass through.
 */
export const authBootstrap = (input: AuthBootstrapInput) =>
	Effect.gen(function* () {
		yield* confirmCloud('auth bootstrap')

		const { users } = yield* acquireAuthAdapter()

		const user = yield* bootstrapFirstAdmin(users, input)

		yield* Console.log('')
		yield* Console.log('┌─── Admin created ──────────────────────────┐')
		yield* Console.log(`│  Email: ${user.email.padEnd(34)}│`)
		yield* Console.log(`│  Name:  ${user.name.padEnd(34)}│`)
		yield* Console.log(`│  Role:  ${(user.role ?? 'user').padEnd(34)}│`)
		yield* Console.log('└────────────────────────────────────────────┘')
		yield* Console.log('')
		yield* Console.log(`  Id: ${user.id}`)
		yield* Console.log('')
		yield* Console.log('Sign in:')
		yield* Console.log(
			'  curl -X POST https://api.batuda.localhost/auth/sign-in/email \\',
		)
		yield* Console.log("    -H 'content-type: application/json' \\")
		yield* Console.log(
			`    -d '{"email":"${user.email}","password":"<your password>"}'`,
		)
		yield* Console.log('')

		return user
	}).pipe(Effect.scoped)
