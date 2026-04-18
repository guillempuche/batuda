/**
 * Reliability harness for tier-level `LanguageModel.Service` instances.
 *
 * `hardenLanguageModel` wraps `generateText` / `generateObject` with:
 *   - `Effect.timeout('120 seconds')` — bounded latency per call
 *   - `Retry-After` honoring: when the provider returns a `RateLimitError`
 *     carrying a `retryAfter` Duration, the harness sleeps that long before
 *     letting the retry schedule's own backoff fire. Prevents thundering-herd
 *     behavior against a provider that has already told us how long to wait.
 *   - `Effect.retry` with jittered exponential backoff (3 attempts, 500ms base)
 *   - Retry gated on `AiError.isRetryable` (network, 5xx, 429, structured-output)
 *   - `Schedule.tapOutput` emits a `research.llm.retry` log ONLY when the
 *     schedule actually decides to retry — not on the final exhausted attempt.
 *   - AiError → `ProviderError { provider, message, recoverable }` at the exit,
 *     so the fallback cascade can pattern-match on the tagged error.
 *   - Optional `Semaphore`-bounded concurrency: when a `permits` option is
 *     supplied the wrapper caps concurrent in-flight calls — defends a shared
 *     tier key against stampede without a full gateway service.
 *
 * `withFallbackLanguageModel` folds N hardened slots into a single caller
 * that tries each slot in order. On `ProviderError` from slot i (regardless
 * of `recoverable`), the cascade invokes slot i+1. The outer-most `ProviderError`
 * escapes when every slot exhausts its retries.
 *
 * `streamText` is passed through unwrapped. Mid-stream retries require a
 * replay buffer on the caller side — deferred until we actually stream LLM
 * output back to the UI (today the research fiber uses only generateText /
 * generateObject).
 */

import { Duration, Effect, Schedule, Semaphore } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import { AiError } from 'effect/unstable/ai'

import { ProviderError } from '../domain/errors'

const DEFAULT_TIMEOUT: Duration.Input = '120 seconds'
const DEFAULT_MAX_ATTEMPTS = 3

const toProviderError = (provider: string, err: unknown): ProviderError => {
	if (err instanceof AiError.AiError) {
		return new ProviderError({
			provider,
			message: err.message,
			recoverable: err.isRetryable,
		})
	}
	if (err instanceof ProviderError) return err
	return new ProviderError({
		provider,
		message: err instanceof Error ? err.message : String(err),
		recoverable: true,
	})
}

const isRetryableFailure = (err: unknown): boolean =>
	err instanceof AiError.AiError && err.isRetryable

const rateLimitRetryAfter = (err: unknown): Duration.Duration | undefined => {
	if (!(err instanceof AiError.AiError)) return undefined
	const reason = err.reason
	if (reason._tag !== 'RateLimitError') return undefined
	return reason.retryAfter
}

/**
 * Jitter between 80%–120% of the base delay, rounded to integer millis.
 *
 * `Schedule.jittered` produces fractional-millis Durations which break
 * `TestClock` (its internal `toNanos` path throws when the accumulated clock
 * ticks are non-integer millis). Rounding here keeps jitter behavior
 * identical in production while letting the test clock stay integer-clean.
 */
const integerJitter = <O, I, E, R>(
	schedule: Schedule.Schedule<O, I, E, R>,
): Schedule.Schedule<O, I, E, R> =>
	Schedule.modifyDelay(schedule, (_, delay) => {
		const ms = Duration.toMillis(Duration.fromInputUnsafe(delay))
		const jittered = ms * 0.8 + ms * 0.4 * Math.random()
		return Effect.succeed(Duration.millis(Math.round(jittered)))
	})

/**
 * Base schedule: jittered exponential backoff, capped at
 * `DEFAULT_MAX_ATTEMPTS - 1` retries (one initial attempt + (N-1) retries).
 *
 * Log shape follows `docs/observability.md`: message uses the
 * `{domain}.{action}` form and `event` annotation the `.{past-tense}` variant,
 * matching `interaction.logged` / `email.sent` conventions elsewhere.
 */
const makeRetrySchedule = (provider: string, tier: string | undefined) =>
	integerJitter(Schedule.exponential('500 millis')).pipe(
		Schedule.bothLeft(Schedule.recurs(DEFAULT_MAX_ATTEMPTS - 1)),
		Schedule.tapOutput(() =>
			Effect.logInfo('llm.retry').pipe(
				Effect.annotateLogs({
					event: 'llm.retried',
					provider,
					...(tier !== undefined ? { tier } : {}),
				}),
			),
		),
	)

/**
 * When a `RateLimitError` carries a `retryAfter`, sleep that long before
 * re-raising the failure. The retry schedule's own jittered backoff still
 * fires afterward — the effective inter-attempt delay becomes
 * `retryAfter + jittered backoff`. Never shorter than the server's ask, which
 * is the correctness invariant we care about.
 */
const sleepForRetryAfter = <A, R>(
	eff: Effect.Effect<A, AiError.AiError, R>,
): Effect.Effect<A, AiError.AiError, R> =>
	eff.pipe(
		Effect.catchIf(
			(err: unknown) => rateLimitRetryAfter(err) !== undefined,
			err => {
				const retryAfter = rateLimitRetryAfter(err) ?? Duration.zero
				return Effect.sleep(retryAfter).pipe(
					Effect.flatMap(() => Effect.fail(err as AiError.AiError)),
				)
			},
		),
	)

export interface HardenOptions {
	readonly timeout?: Duration.Input
	/**
	 * Optional concurrency limit. When provided, an in-memory `Semaphore`
	 * gates the wrapped methods so at most `permits` calls run in parallel
	 * against this slot. A typical value is `Math.max(2, Math.floor(rpm / 4))`.
	 */
	readonly permits?: number
	/**
	 * Tier label for observability (`agent` / `extract` / `writer`). Surfaced
	 * on retry logs and the `llm.call` span so traces group by phase.
	 */
	readonly tier?: string
}

const harden =
	(
		provider: string,
		timeout: Duration.Input,
		semaphore: Semaphore.Semaphore | undefined,
		tier: string | undefined,
	) =>
	<A, R>(eff: Effect.Effect<A, AiError.AiError, R>) => {
		const schedule = makeRetrySchedule(provider, tier)
		const withRetryAfter = sleepForRetryAfter(eff)
		const timed = Effect.timeout(withRetryAfter, timeout) as Effect.Effect<
			A,
			unknown,
			R
		>
		const wrapped = timed.pipe(
			Effect.retry({ schedule, while: isRetryableFailure }),
			Effect.mapError((err: unknown) => toProviderError(provider, err)),
		) as Effect.Effect<A, ProviderError, R>
		return semaphore ? semaphore.withPermits(1)(wrapped) : wrapped
	}

/**
 * Wrap a single-tier LanguageModel with timeout + retry + error mapping.
 * The result still conforms to `LanguageModel.Service`, but its failure
 * channel is `ProviderError` instead of `AiError`.
 *
 * Each call is wrapped in an `llm.call` span so retries appear as nested
 * span events in Honeycomb / Tempo — per `docs/observability.md` wide-events
 * pattern.
 */
export const hardenLanguageModel = (
	inner: LanguageModel.Service,
	provider: string,
	opts?: HardenOptions,
): LanguageModel.Service => {
	const semaphore =
		opts?.permits !== undefined ? Semaphore.makeUnsafe(opts.permits) : undefined
	const tier = opts?.tier
	const wrap = harden(
		provider,
		opts?.timeout ?? DEFAULT_TIMEOUT,
		semaphore,
		tier,
	)
	const spanAttributes: Record<string, string> = {
		'llm.provider': provider,
		...(tier !== undefined ? { 'llm.tier': tier } : {}),
	}
	const generateText = (options: unknown) =>
		wrap(
			inner.generateText(options as never) as unknown as Effect.Effect<
				unknown,
				AiError.AiError
			>,
		).pipe(
			Effect.withSpan('llm.call', {
				attributes: { ...spanAttributes, 'llm.method': 'generateText' },
			}),
		)
	const generateObject = (options: unknown) =>
		wrap(
			inner.generateObject(options as never) as unknown as Effect.Effect<
				unknown,
				AiError.AiError
			>,
		).pipe(
			Effect.withSpan('llm.call', {
				attributes: { ...spanAttributes, 'llm.method': 'generateObject' },
			}),
		)
	return {
		generateText,
		generateObject,
		streamText: inner.streamText,
	} as unknown as LanguageModel.Service
}

/**
 * Cascade N tier-instances as a single caller. Each slot is already hardened,
 * so retries happen *within* a slot; falling back to the next slot is the
 * last resort when a slot's retry budget is exhausted.
 *
 * The returned service surfaces `ProviderError` if every slot fails. Slot 0
 * alone (no fallback) is returned unchanged for zero runtime overhead.
 */
export const withFallbackLanguageModel = (
	slots: ReadonlyArray<LanguageModel.Service>,
): LanguageModel.Service => {
	const [head, ...tail] = slots
	if (head === undefined) {
		throw new Error('withFallbackLanguageModel: requires at least one slot')
	}
	if (tail.length === 0) return head

	const cascade = <A, R>(
		invoke: (svc: LanguageModel.Service) => Effect.Effect<A, ProviderError, R>,
	): Effect.Effect<A, ProviderError, R> =>
		tail.reduce<Effect.Effect<A, ProviderError, R>>(
			(acc, svc) =>
				acc.pipe(
					Effect.catchTag('ProviderError', err =>
						Effect.gen(function* () {
							yield* Effect.logInfo('llm.fallback').pipe(
								Effect.annotateLogs({
									event: 'llm.fell_back',
									from_provider: err.provider,
								}),
							)
							return yield* invoke(svc)
						}),
					),
				),
			invoke(head),
		)

	const generateText = (options: unknown) =>
		cascade(
			svc =>
				svc.generateText(options as never) as unknown as Effect.Effect<
					unknown,
					ProviderError
				>,
		)
	const generateObject = (options: unknown) =>
		cascade(
			svc =>
				svc.generateObject(options as never) as unknown as Effect.Effect<
					unknown,
					ProviderError
				>,
		)
	return {
		generateText,
		generateObject,
		streamText: head.streamText,
	} as unknown as LanguageModel.Service
}
