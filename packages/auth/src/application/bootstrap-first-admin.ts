import { Effect } from 'effect'

import {
	type AuthConfigError,
	type UserAlreadyExists,
	UsersAlreadyExist,
} from '../domain/errors'
import type { AuthUser } from '../domain/types'
import type { UserRepository } from './ports'

export interface BootstrapFirstAdminInput {
	readonly email: string
	readonly name: string
	readonly password: string
}

/**
 * Create the very first admin. Refuses if *any* user already exists — this
 * command is meant to be run exactly once on a fresh database, and the guard
 * prevents an accidental re-run from silently creating a second admin.
 *
 * The caller gates cloud runs via `confirmCloud` at the CLI layer, not here.
 */
export const bootstrapFirstAdmin = (
	users: UserRepository,
	input: BootstrapFirstAdminInput,
): Effect.Effect<
	AuthUser,
	UsersAlreadyExist | UserAlreadyExists | AuthConfigError
> =>
	Effect.gen(function* () {
		const count = yield* users.countAll
		if (count > 0) {
			return yield* Effect.fail(new UsersAlreadyExist({ count }))
		}
		return yield* users.createWithPassword({
			email: input.email,
			name: input.name,
			password: input.password,
			role: 'admin',
		})
	})
