import { Duration, Effect, Exit, Fiber, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import type { LanguageModel } from 'effect/unstable/ai'
import { AiError } from 'effect/unstable/ai'
import { describe, expect, it } from 'vitest'

import { hardenLanguageModel, withFallbackLanguageModel } from './_harden'

// ── Test helpers ──
// Every stub counts invocations through a `Ref` so assertions stay consistent
// under concurrent retries (plain closure mutation works for this single-fiber
// suite but would hide interleaving bugs in larger tests).

type Outcome = Effect.Effect<{ text: string; usage: unknown }, AiError.AiError>

const makeStubLm = (
	counterRef: Ref.Ref<number>,
	impl: (attempt: number) => Outcome,
): LanguageModel.Service =>
	({
		generateText: () =>
			Effect.gen(function* () {
				const n = yield* Ref.updateAndGet(counterRef, x => x + 1)
				return yield* impl(n)
			}),
		generateObject: () => Effect.succeed({}),
		streamText: () => Effect.succeed({}),
	}) as unknown as LanguageModel.Service

const makeTaggedStub = (
	tag: string,
	callsRef: Ref.Ref<ReadonlyArray<string>>,
	outcome: (() => Outcome) | 'fail',
): LanguageModel.Service =>
	({
		generateText: () =>
			Effect.gen(function* () {
				yield* Ref.update(callsRef, xs => [...xs, tag])
				if (outcome === 'fail') return yield* Effect.fail(mkNetworkError())
				return yield* outcome()
			}),
		generateObject: () => Effect.succeed({}),
		streamText: () => Effect.succeed({}),
	}) as unknown as LanguageModel.Service

const emptyRequest = {
	method: 'POST' as const,
	url: 'https://stub.test/v1/chat',
	urlParams: [] as ReadonlyArray<readonly [string, string]>,
	hash: undefined,
	headers: {} as Record<string, string>,
}

const mkNetworkError = (): AiError.AiError =>
	new AiError.AiError({
		module: 'test',
		method: 'generateText',
		reason: new AiError.NetworkError({
			reason: 'TransportError',
			request: emptyRequest,
		}),
	})

const mkAuthError = (): AiError.AiError =>
	new AiError.AiError({
		module: 'test',
		method: 'generateText',
		reason: new AiError.AuthenticationError({ kind: 'InvalidKey' }),
	})

const mkRateLimitError = (retryAfter: Duration.Duration): AiError.AiError =>
	new AiError.AiError({
		module: 'test',
		method: 'generateText',
		reason: new AiError.RateLimitError({ retryAfter }),
	})

/**
 * Run a program with `TestClock` installed, fork the unit-under-test inside it,
 * and tick virtual time forward in small increments until the fiber settles.
 * Ticking beats a single large `adjust` because jittered exponential retry
 * schedules register a fresh sleep deadline *after* each wake — a single big
 * adjust can race past newly-registered sleeps and never resolve them.
 */
const runWithVirtualClock = async <A, E>(
	build: () => Effect.Effect<A, E, never>,
	budgetMs = 60_000,
	stepMs = 100,
): Promise<Exit.Exit<A, E>> => {
	const program = Effect.gen(function* () {
		const fiber = yield* Effect.forkChild(build())
		for (let elapsed = 0; elapsed < budgetMs; elapsed += stepMs) {
			if (fiber.pollUnsafe() !== undefined) break
			yield* Effect.yieldNow
			yield* TestClock.adjust(`${stepMs} millis`)
		}
		return yield* Fiber.await(fiber)
	})
	return Effect.runPromise(
		Effect.scoped(program).pipe(Effect.provide(TestClock.layer())),
	)
}

const invokeGenerateText = (
	svc: LanguageModel.Service,
): Effect.Effect<unknown, unknown, never> =>
	(
		svc.generateText as unknown as (
			o: unknown,
		) => Effect.Effect<unknown, unknown, never>
	)({ prompt: 'hi' })

describe('hardenLanguageModel', () => {
	it('should return the successful response after transient failures under its retry budget', async () => {
		// GIVEN a stub LM that fails twice with a retryable network error then succeeds
		const attemptsRef = Ref.makeUnsafe(0)
		const stub = makeStubLm(attemptsRef, attempt =>
			attempt <= 2
				? Effect.fail(mkNetworkError())
				: Effect.succeed({ text: `ok@${attempt}`, usage: {} }),
		)
		const hardened = hardenLanguageModel(stub, 'together')

		// WHEN generateText runs under TestClock (jittered sleeps resolve virtually)
		const exit = await runWithVirtualClock(() => invokeGenerateText(hardened))

		// THEN the third attempt's payload surfaces
		// AND the inner LM was invoked exactly 3 times
		expect(Exit.isSuccess(exit)).toBe(true)
		expect(Ref.getUnsafe(attemptsRef)).toBe(3)
	})

	it('should stop retrying once a non-recoverable error is observed', async () => {
		// GIVEN a stub LM that fails with an authentication error (non-retryable)
		const attemptsRef = Ref.makeUnsafe(0)
		const stub = makeStubLm(attemptsRef, () => Effect.fail(mkAuthError()))
		const hardened = hardenLanguageModel(stub, 'together')

		// WHEN generateText is invoked
		const exit = await runWithVirtualClock(() => invokeGenerateText(hardened))

		// THEN the effect fails (surfaced as ProviderError)
		// AND exactly one attempt was recorded — no retries on non-recoverable errors
		expect(Exit.isFailure(exit)).toBe(true)
		expect(Ref.getUnsafe(attemptsRef)).toBe(1)
	})

	it('should sleep for the RateLimitError retryAfter before re-attempting', async () => {
		// GIVEN a stub LM that fails twice with a 7-second retryAfter hint then succeeds
		// AND a harness whose default jittered-exponential backoff would normally fire at ~500ms/~1s
		const attemptsRef = Ref.makeUnsafe(0)
		const retryAfter = Duration.seconds(7)
		const stub = makeStubLm(attemptsRef, attempt =>
			attempt <= 2
				? Effect.fail(mkRateLimitError(retryAfter))
				: Effect.succeed({ text: `ok@${attempt}`, usage: {} }),
		)
		const hardened = hardenLanguageModel(stub, 'together')

		// WHEN the harness runs under TestClock — the helper ticks forward until
		// the fiber settles, so the clock never races past a newly-scheduled sleep
		const exit = await runWithVirtualClock(() => invokeGenerateText(hardened))

		// THEN the harness waited at least the server's ask before re-attempting
		// AND all three attempts fired within budget
		expect(Exit.isSuccess(exit)).toBe(true)
		expect(Ref.getUnsafe(attemptsRef)).toBe(3)
	})

	it('should cap concurrent in-flight calls at the configured permit count', async () => {
		// GIVEN a stub LM that tracks its in-flight concurrency and sleeps 1s per call
		const inFlightRef = Ref.makeUnsafe(0)
		const peakRef = Ref.makeUnsafe(0)
		const busySvc = {
			generateText: () =>
				Effect.gen(function* () {
					const current = yield* Ref.updateAndGet(inFlightRef, n => n + 1)
					yield* Ref.update(peakRef, p => (current > p ? current : p))
					yield* Effect.sleep('1 second')
					yield* Ref.update(inFlightRef, n => n - 1)
					return { text: 'ok', usage: {} }
				}),
			generateObject: () => Effect.succeed({}),
			streamText: () => Effect.succeed({}),
		} as unknown as LanguageModel.Service
		// AND a harness with permits=2
		const hardened = hardenLanguageModel(busySvc, 'together', { permits: 2 })

		// WHEN 10 callers invoke the hardened service concurrently under TestClock
		const program = Effect.gen(function* () {
			const fibers = yield* Effect.forEach(
				Array.from({ length: 10 }, (_, i) => i),
				() => Effect.forkChild(invokeGenerateText(hardened)),
				{ concurrency: 'unbounded' },
			)
			yield* TestClock.adjust('20 seconds')
			yield* Effect.forEach(fibers, f => Fiber.await(f), {
				concurrency: 'unbounded',
			})
		})
		await Effect.runPromise(
			Effect.scoped(program).pipe(Effect.provide(TestClock.layer())),
		)

		// THEN peak concurrency never exceeded the 2-permit cap
		expect(Ref.getUnsafe(peakRef)).toBeLessThanOrEqual(2)
		// AND all callers eventually released their permits
		expect(Ref.getUnsafe(inFlightRef)).toBe(0)
	})

	it('should fail when a call exceeds the configured timeout', async () => {
		// GIVEN a stub LM whose call never resolves within the budget
		const neverSvc = {
			generateText: () =>
				Effect.sleep('5 hours').pipe(Effect.as({ text: 'never', usage: {} })),
			generateObject: () => Effect.succeed({}),
			streamText: () => Effect.succeed({}),
		} as unknown as LanguageModel.Service
		// AND a harness with a 1-second timeout override
		const hardened = hardenLanguageModel(neverSvc, 'together', {
			timeout: '1 second',
		})

		// WHEN advanced 5 seconds of virtual time
		const exit = await runWithVirtualClock(
			() => invokeGenerateText(hardened),
			5_000,
		)

		// THEN the harness surfaces a failure (timeout does not trigger the retry gate)
		expect(Exit.isFailure(exit)).toBe(true)
	})
})

describe('withFallbackLanguageModel', () => {
	it('should surface the first slot response when the primary succeeds', async () => {
		// GIVEN two slots; slot 0 succeeds immediately
		const callsRef = Ref.makeUnsafe<ReadonlyArray<string>>([])
		const slot0 = hardenLanguageModel(
			makeTaggedStub('a', callsRef, () =>
				Effect.succeed({ text: 'a', usage: {} }),
			),
			'together',
		)
		const slot1 = hardenLanguageModel(
			makeTaggedStub('b', callsRef, () =>
				Effect.succeed({ text: 'b', usage: {} }),
			),
			'fireworks',
		)
		const composed = withFallbackLanguageModel([slot0, slot1])

		// WHEN the composed model is invoked
		const exit = await runWithVirtualClock(() => invokeGenerateText(composed))

		// THEN slot 0 was invoked
		// AND slot 1 was never tapped
		expect(Exit.isSuccess(exit)).toBe(true)
		expect(Ref.getUnsafe(callsRef)).toEqual(['a'])
	})

	it('should fall back to the next slot after the primary exhausts its retries', async () => {
		// GIVEN slot 0 always fails with a retryable error, slot 1 succeeds
		const callsRef = Ref.makeUnsafe<ReadonlyArray<string>>([])
		const slot0 = hardenLanguageModel(
			makeTaggedStub('a', callsRef, 'fail'),
			'together',
		)
		const slot1 = hardenLanguageModel(
			makeTaggedStub('b', callsRef, () =>
				Effect.succeed({ text: 'b', usage: {} }),
			),
			'fireworks',
		)
		const composed = withFallbackLanguageModel([slot0, slot1])

		// WHEN the composed model is invoked
		const exit = await runWithVirtualClock(() => invokeGenerateText(composed))

		// THEN the composed call succeeds via slot 1
		// AND slot 0 was retried 3 times before the cascade advanced
		expect(Exit.isSuccess(exit)).toBe(true)
		const calls = Ref.getUnsafe(callsRef)
		expect(calls.filter(c => c === 'a').length).toBe(3)
		expect(calls.filter(c => c === 'b').length).toBe(1)
	})
})
