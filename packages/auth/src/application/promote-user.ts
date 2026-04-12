import type { Effect } from 'effect'

import type { AuthConfigError, UserNotFound } from '../domain/errors'
import type { Role } from '../domain/types'
import type { UserRepository } from './ports'

/**
 * Set a user's role to `admin` or `user`. Shared between the `promote` and
 * `demote` CLI commands — they differ only in the role they pass.
 */
export const promoteUser = (
	users: UserRepository,
	email: string,
	role: Role,
): Effect.Effect<void, UserNotFound | AuthConfigError> =>
	users.setRole(email, role)
