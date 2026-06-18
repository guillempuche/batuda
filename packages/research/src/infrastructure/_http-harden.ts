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
 *   - a `provider.retried` log on each actual retry decision.
 *
 * A timed-out attempt becomes a recoverable `ProviderError`, so the same
 * `recoverable` predicate drives both retry here and the cross-vendor fallback
 * cascade in `_fallback.ts`.
 */

import { Duration, Effect, Schedule } from 'effect'

import { ProviderError } from '../domain/errors'

const DEFAULT_TIMEOUT: Duration.Input = '30 seconds'
const DEFAULT_MAX_ATTEMPTS = 3

/**
 * Jitter between 80%–120% of the base delay, rounded to integer millis — the
 * same `TestClock`-safe rounding `_harden.ts` uses (fractional-millis Durations
 * break the test clock's nanos path).
 */
const integerJitter = <O, I, E, R>(
	schedule: Schedule.Schedule<O, I, E, R>,
): Schedule.Schedule<O, I, E, R> =>
	Schedule.modifyDelay(schedule, (_, delay) => {
		const ms = Duration.toMillis(Duration.fromInputUnsafe(delay))
		const jittered = ms * 0.8 + ms * 0.4 * Math.random()
		return Effect.succeed(Duration.millis(Math.round(jittered)))
	})

const makeSchedule = (provider: string) =>
	integerJitter(Schedule.exponential('500 millis')).pipe(
		Schedule.bothLeft(Schedule.recurs(DEFAULT_MAX_ATTEMPTS - 1)),
		Schedule.tapOutput(() =>
			Effect.logInfo('provider.retry').pipe(
				Effect.annotateLogs({ event: 'provider.retried', provider }),
			),
		),
	)

export interface HttpHardenOptions {
	readonly timeout?: Duration.Input
}

/**
 * Wrap one HTTP provider call with timeout + recoverable-only retry. Returns a
 * function so a provider builds it once (`const harden = hardenHttp('firecrawl')`)
 * and reuses it per request.
 */
export const hardenHttp =
	(provider: string, opts?: HttpHardenOptions) =>
	<A, R>(
		eff: Effect.Effect<A, ProviderError, R>,
	): Effect.Effect<A, ProviderError, R> => {
		const attempt = Effect.timeout(eff, opts?.timeout ?? DEFAULT_TIMEOUT).pipe(
			Effect.mapError(
				(err): ProviderError =>
					err instanceof ProviderError
						? err
						: new ProviderError({
								provider,
								message: 'request timed out',
								recoverable: true,
							}),
			),
		)
		return attempt.pipe(
			Effect.retry({
				schedule: makeSchedule(provider),
				while: (e: ProviderError) => e.recoverable,
			}),
		)
	}
