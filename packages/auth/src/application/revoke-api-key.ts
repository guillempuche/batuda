import type { Effect } from 'effect'

import type { ApiKeyNotFound, AuthConfigError } from '../domain/errors'
import type { ApiKeyRepository } from './ports'

export const revokeApiKey = (
	keys: ApiKeyRepository,
	keyId: string,
): Effect.Effect<void, ApiKeyNotFound | AuthConfigError> => keys.revoke(keyId)
