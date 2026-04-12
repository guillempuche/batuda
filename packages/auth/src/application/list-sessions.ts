import type { Effect } from 'effect'

import type { AuthConfigError } from '../domain/errors'
import type { SessionRecord } from '../domain/types'
import type { SessionRepository } from './ports'

export const listSessions = (
	sessions: SessionRepository,
	email: string | undefined,
): Effect.Effect<ReadonlyArray<SessionRecord>, AuthConfigError> =>
	sessions.list(email)
