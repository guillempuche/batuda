/**
 * Reliability harness for tier-level `LanguageModel.Service` instances.
 *
 * `hardenLanguageModel` wraps `generateText` / `generateObject` with:
 *   - `Effect.timeout(<per-tier>)` — bounded latency per call. Each tier passes
 *     its own `RESEARCH_LLM_<TIER>_TIMEOUT_SEC` (default 60s); a timeout is not
 *     retried, so a wedged endpoint fails fast and cascades to the next slot
 *     instead of hanging the whole run.
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
 *   - Before that mapping erases it, the failure's real shape (timeout vs the
 *     provider's HTTP status / reason) is written to the `llm.call` span and an
 *     error log, so a generic "<provider> request failed" stays diagnosable.
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

import { Cause, Duration, Effect, Schedule, Semaphore } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import { AiError } from 'effect/unstable/ai'

import { ProviderError } from '../domain/errors'

const DEFAULT_TIMEOUT: Duration.Input = '60 seconds'
const DEFAULT_MAX_ATTEMPTS = 3

// Pull a human-usable message out of an arbitrary thrown value, or `undefined`
// when there is nothing usable (an absent/blank message, or a bare object).
const messageOf = (err: unknown): string | undefined => {
	if (err instanceof Error) return err.message || undefined
	if (typeof err === 'string') return err || undefined
	if (err === null || err === undefined) return undefined
	// Some callers throw a bare object that carries the message (e.g. `{ message,
	// code }`); read it before falling back to `String(err)`'s "[object Object]".
	if (typeof err === 'object' && 'message' in err) {
		const inner = err.message
		if (typeof inner === 'string' && inner.length > 0) return inner
	}
	const text = String(err)
	return text === '[object Object]' ? undefined : text
}

// The HTTP status the provider returned, when the failure carries one. A
// transport failure (connection reset, DNS, TLS) never received a response, so
// it reports no status; a 429 / 5xx / 4xx does.
const httpStatusOf = (err: AiError.AiError): number | undefined => {
	const reason = err.reason
	return 'http' in reason ? reason.http?.response?.status : undefined
}

interface FailureInfo {
	readonly kind: 'timeout' | 'provider' | 'unknown'
	readonly reason?: string
	readonly status?: number
	readonly message: string
}

// Read the true shape of a failure before it collapses into a ProviderError
// (only provider + message + recoverable). `Effect.timeout` raises a bare
// TimeoutError with no message, and a provider blip can arrive as an AiError
// whose message we couldn't extract — both used to surface as the contentless
// "<provider> request failed", hiding whether it was a timeout, a 429, or a 500.
const describeFailure = (
	provider: string,
	err: unknown,
	timeout: Duration.Input,
): FailureInfo => {
	if (Cause.isTimeoutError(err)) {
		return {
			kind: 'timeout',
			message: `${provider} request timed out after ${Duration.format(Duration.fromInputUnsafe(timeout))}`,
		}
	}
	if (err instanceof AiError.AiError) {
		const status = httpStatusOf(err)
		return {
			kind: 'provider',
			reason: err.reason._tag,
			...(status !== undefined ? { status } : {}),
			message: err.message,
		}
	}
	return {
		kind: 'unknown',
		message: messageOf(err) ?? `${provider} request failed`,
	}
}

const toProviderError = (
	provider: string,
	err: unknown,
	timeout: Duration.Input,
): ProviderError => {
	if (err instanceof ProviderError) return err
	// `describeFailure` always yields a non-empty message; a ProviderError built
	// with an empty message rejects its own construction and throws a second,
	// contentless error over the real one — so the non-empty invariant matters.
	const message = describeFailure(provider, err, timeout).message
	return err instanceof AiError.AiError
		? new ProviderError({ provider, message, recoverable: err.isRetryable })
		: new ProviderError({ provider, message, recoverable: true })
}

// Emit the failure's real shape onto the `llm.call` span and a log line before
// the mapping above erases it, so a "<provider> request failed" run stays
// diagnosable in one query. Fires once on the final surfaced failure after
// retries, not per attempt. Logged at warning, not error: one slot failing may
// still be recovered by the fallback cascade — the real error is the run-level
// failure, recorded when every slot is exhausted.
const reportFailure = (
	provider: string,
	tier: string | undefined,
	err: unknown,
	timeout: Duration.Input,
) => {
	const info = describeFailure(provider, err, timeout)
	return Effect.annotateCurrentSpan({
		'llm.error.kind': info.kind,
		...(info.reason !== undefined ? { 'llm.error.reason': info.reason } : {}),
		...(info.status !== undefined ? { 'llm.error.status': info.status } : {}),
	}).pipe(
		Effect.flatMap(() =>
			Effect.logWarning('llm.call_failed').pipe(
				Effect.annotateLogs({
					event: 'llm.call_failed',
					provider,
					kind: info.kind,
					...(tier !== undefined ? { tier } : {}),
					...(info.reason !== undefined ? { reason: info.reason } : {}),
					...(info.status !== undefined ? { status: info.status } : {}),
				}),
			),
		),
	)
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
			Effect.tapError((err: unknown) =>
				reportFailure(provider, tier, err, timeout),
			),
			Effect.mapError((err: unknown) =>
				toProviderError(provider, err, timeout),
			),
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
