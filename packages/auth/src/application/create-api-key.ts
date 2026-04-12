import type { Effect } from 'effect'

import type { AuthConfigError, UserNotFound } from '../domain/errors'
import type {
	ApiKeyRepository,
	CreateApiKeyInput,
	CreatedApiKey,
} from './ports'

/**
 * Create an API key owned by an existing user. The adapter looks up the user
 * by email, forwards to Better-Auth's apiKey plugin, and returns a full
 * `CreatedApiKey` (including the one-time plaintext `key` the caller must
 * display now — Better-Auth hashes it on write so it is unrecoverable).
 */
export const createApiKey = (
	keys: ApiKeyRepository,
	input: CreateApiKeyInput,
): Effect.Effect<CreatedApiKey, UserNotFound | AuthConfigError> =>
	keys.create(input)
