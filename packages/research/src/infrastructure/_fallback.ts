import { Effect } from 'effect'

import type { ProviderError } from '../domain/errors'

/**
 * Fold N provider instances into a single caller that tries each in order.
 * On `ProviderError` from slot i, the caller transparently invokes slot i+1.
 * Non-provider defects (Config failures, runtime exceptions) propagate.
 *
 * Only a `ProviderError` makes the caller try the next slot; any other failure
 * the invoke can raise (the `E` param — e.g. a routing outcome) passes straight
 * through, uncascaded.
 *
 * Empty `SearchResult`s / zero-hit responses are successes, not errors, and
 * therefore do NOT cascade — a genuine zero-result search shouldn't triple
 * the cost by retrying across providers.
 */
export const withFallback =
	<Service, Input, Output, R, E = never>(
		instances: ReadonlyArray<Service>,
		invoke: (
			svc: Service,
			input: Input,
		) => Effect.Effect<Output, ProviderError | E, R>,
	) =>
	(input: Input): Effect.Effect<Output, ProviderError | E, R> => {
		const [head, ...tail] = instances
		if (head === undefined) {
			return Effect.die(
				new Error('withFallback: requires at least one provider instance'),
			)
		}
		return tail.reduce<Effect.Effect<Output, ProviderError | E, R>>(
			(acc, svc) =>
				acc.pipe(Effect.catchTag('ProviderError', () => invoke(svc, input))),
			invoke(head, input),
		)
	}
