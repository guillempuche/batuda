import type { Effect } from 'effect'

import type { AuthConfigError } from '../domain/errors'
import type { ApiKeyRecord } from '../domain/types'
import type { ApiKeyRepository } from './ports'

export const listApiKeys = (
	keys: ApiKeyRepository,
	email: string | undefined,
): Effect.Effect<ReadonlyArray<ApiKeyRecord>, AuthConfigError> =>
	keys.list(email)
