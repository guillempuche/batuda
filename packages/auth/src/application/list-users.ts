import type { Effect } from 'effect'

import type { AuthConfigError } from '../domain/errors'
import type { AuthUser } from '../domain/types'
import type { UserRepository } from './ports'

export const listUsers = (
	users: UserRepository,
): Effect.Effect<ReadonlyArray<AuthUser>, AuthConfigError> => users.listAll
