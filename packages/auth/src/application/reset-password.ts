import type { Effect } from 'effect'

import type { AuthConfigError, UserNotFound } from '../domain/errors'
import type { UserRepository } from './ports'

export const resetPassword = (
	users: UserRepository,
	email: string,
	password: string,
): Effect.Effect<void, UserNotFound | AuthConfigError> =>
	users.setPassword(email, password)
