import { Console, Effect } from 'effect'

import { createApiKey } from '@batuda/auth'

import { acquireAuthAdapter } from '../lib/auth-adapter'
import { confirmCloud } from '../lib/confirm-cloud'

export interface AuthCreateKeyInput {
	readonly email: string
	readonly name: string
	readonly prefix: string
	readonly expiresIn: number | undefined
}

/**
 * `pnpm cli auth create-key` — mint a Better-Auth API key for an existing
 * user. The plaintext is shown once; Better-Auth hashes it on write so a
 * lost key cannot be recovered.
 */
export const authCreateKey = (input: AuthCreateKeyInput) =>
	Effect.gen(function* () {
		yield* confirmCloud('auth create-key')
		yield* Effect.logInfo(`Creating API key for ${input.email}...`)

		const { keys } = yield* acquireAuthAdapter()

		const created = yield* createApiKey(keys, input)

		yield* Console.log('')
		yield* Console.log('┌─── API key created ────────────────────────┐')
		yield* Console.log(`│  Owner:  ${created.ownerEmail.padEnd(33)}│`)
		yield* Console.log(`│  Role:   ${created.ownerRole.padEnd(33)}│`)
		yield* Console.log(`│  Name:   ${created.name.padEnd(33)}│`)
		yield* Console.log(`│  KeyId:  ${created.id.padEnd(33)}│`)
		yield* Console.log('└────────────────────────────────────────────┘')
		yield* Console.log('')
		yield* Console.log('Plaintext key (shown only once — copy now):')
		yield* Console.log('')
		yield* Console.log(`  ${created.key}`)
		yield* Console.log('')

		if (created.ownerRole !== 'admin') {
			yield* Console.log(
				'\u26a0  Owner is not admin — this key cannot call /auth/admin/create-user.',
			)
			yield* Console.log('')
			return created
		}

		yield* Console.log('Sign up a new user with it:')
		yield* Console.log('')
		yield* Console.log(
			'  curl -X POST https://api.batuda.localhost/auth/admin/create-user \\',
		)
		yield* Console.log("    -H 'content-type: application/json' \\")
		yield* Console.log(`    -H 'x-api-key: ${created.key}' \\`)
		yield* Console.log(
			'    -d \'{"email":"alice@example.com","password":"temp-password-123","name":"Alice","role":"user"}\'',
		)
		yield* Console.log('')

		return created
	}).pipe(Effect.scoped)
