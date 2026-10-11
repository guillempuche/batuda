/**
 * Reliability harness for non-LLM HTTP providers (search / scrape / extract /
 * registry / report). The LLM tiers have their own richer harness in
 * `_harden.ts`; this is the slimmer equivalent for a plain
 * `Effect<A, ProviderError>` HTTP call:
 *
 *   - `Effect.timeout` — bounds a single attempt so a hung socket can't pin a
 *     research fiber permit indefinitely (the Brave template had none).
 *   - jittered exponential backoff, capped at `DEFAULT_MAX_ATTEMPTS` total.
 *   - retry gated on `ProviderError.recoverable` — a 4xx auth/quota failure
 *     (recoverable=false) fails fast; a 5xx/429/timeout retries.
 *   - a `provider.retried` log written ONLY when another attempt is really about
 *     to be made — not for a failure the gate above refuses, and not on the
 *     final exhausted attempt.
 *
 * A timed-out attempt becomes a recoverable `ProviderError`, so the same
 * `recoverable` predicate drives both retry here and the cross-vendor fallback
 * cascade in `_fallback.ts`.
 */

import { Cause, type Duration, Effect, Schedule } from 'effect'

import { ProviderError } from '../domain/errors'
import { integerJitter } from './_jitter'

const DEFAULT_TIMEOUT: Duration.Input = '30 seconds'
const DEFAULT_MAX_ATTEMPTS = 3

// A rate limit or a server-side failure is worth another try; any other 4xx is
// a bad key, no credit or a bad request, which asking again cannot fix.
export const statusRecoverable = (status: number): boolean =>
	status === 429 || status >= 500

const isRecoverable = (err: unknown): boolean =>
	err instanceof ProviderError && err.recoverable

const makeSchedule = (provider: string) =>
	integerJitter(Schedule.exponential('500 millis')).pipe(
		Schedule.upTo({ times: DEFAULT_MAX_ATTEMPTS - 1 }),
		// The gate belongs here, ahead of the log, and not in `Effect.retry`'s own
		// `while`: that one is consulted only once the schedule has already run, so
		// a failure it refuses has been logged as a retry before anything asks
		// whether to make one.
		Schedule.while(({ input }) => isRecoverable(input)),
		Schedule.tap(() =>
			Effect.logInfo('provider.retry').pipe(
				Effect.annotateLogs({ event: 'provider.retried', provider }),
			),
		),
	)

/**
 * Wrap one HTTP provider call with timeout + recoverable-only retry. Returns a
 * function so a provider builds it once (`const harden = hardenHttp('firecrawl')`)
 * and reuses it per request.
 *
 * The wrapped call may also fail with an extra routing error `Ex` (e.g. a scrape
 * of a site the provider flatly refuses). Only the timeout is re-cast to a
 * recoverable ProviderError; a ProviderError keeps its own `recoverable` flag and
 * an `Ex` passes straight through — never retried and never mislabeled a timeout.
 */
export const hardenHttp =
	(provider: string) =>
	<A, Ex, R>(
		eff: Effect.Effect<A, ProviderError | Ex, R>,
	): Effect.Effect<A, ProviderError | Ex, R> => {
		const attempt = Effect.timeout(eff, DEFAULT_TIMEOUT).pipe(
			Effect.mapError((err): ProviderError | Ex =>
				Cause.isTimeoutError(err)
					? new ProviderError({
							provider,
							message: 'request timed out',
							recoverable: true,
						})
					: err,
			),
		)
		return attempt.pipe(Effect.retry(makeSchedule(provider)))
	}
