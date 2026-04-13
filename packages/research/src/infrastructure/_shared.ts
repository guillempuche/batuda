/**
 * Shared helpers for research provider infrastructure.
 *
 * Two factory patterns for non-functional providers:
 * - `disabledError` — capability intentionally turned off (provider=none)
 * - `notYetImplementedError` — provider value recognised but code not written yet
 */

import { Effect } from 'effect'

import { ProviderError } from '../domain/errors'

/** Error for a capability that is intentionally disabled (provider=none). */
export const disabledError = (capability: string) =>
	Effect.fail(
		new ProviderError({
			provider: capability,
			message: `capability disabled (provider=none). Set RESEARCH_*_PROVIDER to enable.`,
			recoverable: false,
		}),
	)

/** Error for a provider value that is recognised but not yet implemented. */
export const notYetImplementedError = (capability: string, provider: string) =>
	Effect.fail(
		new ProviderError({
			provider,
			message: `provider '${provider}' for ${capability} is not yet implemented`,
			recoverable: false,
		}),
	)
