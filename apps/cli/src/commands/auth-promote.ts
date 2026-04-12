import { Console, Effect } from 'effect'

import { promoteUser, type Role } from '@engranatge/auth'

import { acquireAuthAdapter } from '../lib/auth-adapter'
import { confirmCloud } from '../lib/confirm-cloud'

export interface AuthPromoteInput {
	readonly email: string
	readonly role: Role
}

/**
 * `pnpm cli auth promote <email> --role admin|user` — change a user's role.
 *
 * Backing shared with the `demote` command (they differ only in the default
 * role). The cloud gate applies because changing an admin's role is a
 * destructive, audit-worthy operation.
 */
export const authPromote = (input: AuthPromoteInput) =>
	Effect.gen(function* () {
		yield* confirmCloud('auth promote')

		const { users } = yield* acquireAuthAdapter()

		yield* promoteUser(users, input.email, input.role)

		yield* Console.log('')
		yield* Console.log(`  \u2713 ${input.email} → role=${input.role}`)
		yield* Console.log('')
	}).pipe(Effect.scoped)
