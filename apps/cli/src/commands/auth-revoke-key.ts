import { Console, Effect } from 'effect'

import { revokeApiKey } from '@engranatge/auth'

import { acquireAuthAdapter } from '../lib/auth-adapter'
import { confirmCloud } from '../lib/confirm-cloud'

export interface AuthRevokeKeyInput {
	readonly keyId: string
}

/**
 * `pnpm cli auth revoke-key <keyId>` — flip `"apiKey".enabled` to false.
 *
 * Does not delete the row: Better-Auth's apiKey plugin needs the record so
 * subsequent auth attempts with that key can fail cleanly instead of
 * returning a 404. Re-enable manually via SQL if the revocation was a
 * mistake.
 */
export const authRevokeKey = (input: AuthRevokeKeyInput) =>
	Effect.gen(function* () {
		yield* confirmCloud('auth revoke-key')

		const { keys } = yield* acquireAuthAdapter()

		yield* revokeApiKey(keys, input.keyId)

		yield* Console.log('')
		yield* Console.log(`  \u2713 Revoked key ${input.keyId}`)
		yield* Console.log('')
	}).pipe(Effect.scoped)
