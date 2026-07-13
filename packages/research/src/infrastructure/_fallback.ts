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

/**
 * Like `withFallback`, but also moves to the next slot when a slot succeeds with
 * an *empty* result, per the caller's `isEmpty` test — not only on error.
 *
 * Search uses this: one vendor returning zero hits is a plausible "found nothing",
 * but a second, richer vendor often has what the first missed, so trying it once is
 * worth the cost (the plain `withFallback` deliberately doesn't, to keep an honest
 * zero-hit cheap). Returns the first non-empty result; if every slot is empty it
 * returns an empty result (a real zero-hit the caller can act on), and it only
 * fails when every slot errored.
 */
export const withFallbackUntil =
	<Service, Input, Output, R>(
		instances: ReadonlyArray<Service>,
		invoke: (
			svc: Service,
			input: Input,
		) => Effect.Effect<Output, ProviderError, R>,
		isEmpty: (output: Output) => boolean,
	) =>
	(input: Input): Effect.Effect<Output, ProviderError, R> =>
		Effect.gen(function* () {
			let lastEmpty: Output | undefined
			let lastError: ProviderError | undefined
			for (const svc of instances) {
				const outcome = yield* invoke(svc, input).pipe(
					Effect.map(result => ({ _tag: 'ok' as const, result })),
					Effect.catchTag('ProviderError', error =>
						Effect.succeed({ _tag: 'err' as const, error }),
					),
				)
				if (outcome._tag === 'err') {
					lastError = outcome.error
					continue
				}
				if (!isEmpty(outcome.result)) return outcome.result
				lastEmpty = outcome.result
			}
			// Every slot was empty or errored: prefer handing back a real zero-hit over
			// an error, so the model gets a clean "nothing found" it can act on.
			if (lastEmpty !== undefined) return lastEmpty
			if (lastError !== undefined) return yield* Effect.fail(lastError)
			return yield* Effect.die(
				new Error('withFallbackUntil: requires at least one provider instance'),
			)
		})
