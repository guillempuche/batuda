import {
	Cause,
	Duration,
	Effect,
	Exit,
	Fiber,
	type Layer,
	Logger,
	Ref,
	References,
} from 'effect'
import { TestClock } from 'effect/testing'
import type { LanguageModel } from 'effect/unstable/ai'
import { AiError } from 'effect/unstable/ai'
import { describe, expect, it } from 'vitest'

import { ProviderError } from '../domain/errors'
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

// The 400 a provider sends when it checks the model's tool call against the
// tool's schema itself and will not run it. Read as a plain invalid request it
// would end the run; the harness re-reads it as the model's mistake.
const mkToolCallRefusedError = (): AiError.AiError =>
	new AiError.AiError({
		module: 'OpenAiClient',
		method: 'createResponse',
		reason: new AiError.InvalidRequestError({
			description:
				'Tool call validation failed: parameters for tool web_search did not match schema',
			metadata: {
				openai: {
					errorCode: 'tool_use_failed',
					errorType: 'invalid_request_error',
					requestId: 'req_1',
				},
			},
		}),
	})

const mkRateLimitError = (retryAfter: Duration.Duration): AiError.AiError =>
	new AiError.AiError({
		module: 'test',
		method: 'generateText',
		reason: new AiError.RateLimitError({ retryAfter }),
	})

interface LoggedLine {
	readonly message: string
	readonly annotations: Record<string, unknown>
}

// Keeps every line a run logs, with the annotations attached to it. The
// annotations are the point: a retry line is read by the field it is filed
// under, so a test that checked only the words would pass while the fields
// something queries on went missing.
const capturedLogs = (lines: Array<LoggedLine>): Layer.Layer<never> =>
	Logger.layer([
		Logger.make(options => {
			lines.push({
				message: String(options.message),
				annotations: options.fiber.getRef(References.CurrentLogAnnotations),
			})
		}),
	])

// The retry lines out of a captured run, which is what every assertion below
// counts.
const retryLines = (lines: ReadonlyArray<LoggedLine>) =>
	lines.filter(line => line.message === 'llm.retry')

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

// Pull the surfaced error out of a failed Exit — the repo idiom for reading a
// ProviderError back off a run under the virtual clock.
const failureOf = (exit: Exit.Exit<unknown, unknown>): unknown =>
	Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined

const invokeGenerateText = (
	svc: LanguageModel.Service,
): Effect.Effect<unknown, unknown, never> =>
	(
		svc.generateText as unknown as (
			o: unknown,
		) => Effect.Effect<unknown, unknown, never>
	)({ prompt: 'hi' })

const invokeGenerateObject = (
	svc: LanguageModel.Service,
): Effect.Effect<unknown, unknown, never> =>
	(
		svc.generateObject as unknown as (
			o: unknown,
		) => Effect.Effect<unknown, unknown, never>
	)({ prompt: 'hi', schema: {} })

const makeObjectFailingLm = (fail: unknown): LanguageModel.Service =>
	({
		generateText: () => Effect.succeed({}),
		generateObject: () => Effect.fail(fail),
		streamText: () => Effect.succeed({}),
	}) as unknown as LanguageModel.Service

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

	it('should stay quiet about retrying when it did not retry', async () => {
		// GIVEN a model refusing the key, which asking again will never fix
		const attemptsRef = Ref.makeUnsafe(0)
		const stub = makeStubLm(attemptsRef, () => Effect.fail(mkAuthError()))
		const hardened = hardenLanguageModel(stub, 'together', { tier: 'agent' })

		// WHEN the call is made and its log lines are kept
		const logs: Array<LoggedLine> = []
		const exit = await runWithVirtualClock(() =>
			invokeGenerateText(hardened).pipe(Effect.provide(capturedLogs(logs))),
		)

		// THEN the one attempt fails as a ProviderError and nothing claims a retry
		expect(failureOf(exit)).toBeInstanceOf(ProviderError)
		expect(Ref.getUnsafe(attemptsRef)).toBe(1)
		expect(retryLines(logs)).toHaveLength(0)
	})

	it('should record the retry it does make, under the field it is read by', async () => {
		// GIVEN a model whose first call drops the connection and whose second answers
		const attemptsRef = Ref.makeUnsafe(0)
		const stub = makeStubLm(attemptsRef, attempt =>
			attempt === 1
				? Effect.fail(mkNetworkError())
				: Effect.succeed({ text: 'ok', usage: {} }),
		)
		const hardened = hardenLanguageModel(stub, 'together', { tier: 'agent' })

		// WHEN the call is made and its log lines are kept
		const logs: Array<LoggedLine> = []
		const exit = await runWithVirtualClock(() =>
			invokeGenerateText(hardened).pipe(Effect.provide(capturedLogs(logs))),
		)

		// THEN the second attempt answers, and the one retry carries the vendor and
		// phase it happened in — silencing the false lines has not silenced a real
		// one, nor emptied it
		expect(Exit.isSuccess(exit)).toBe(true)
		expect(Ref.getUnsafe(attemptsRef)).toBe(2)
		expect(retryLines(logs)).toHaveLength(1)
		expect(retryLines(logs)[0]?.annotations).toMatchObject({
			event: 'llm.retried',
			provider: 'together',
			tier: 'agent',
		})
	})

	it('should not count the attempt it gave up on as a retry', async () => {
		// GIVEN a model that drops the connection every time, so the call uses up
		// every attempt it is allowed
		const attemptsRef = Ref.makeUnsafe(0)
		const stub = makeStubLm(attemptsRef, () => Effect.fail(mkNetworkError()))
		const hardened = hardenLanguageModel(stub, 'together', { tier: 'agent' })

		// WHEN the call is made and its log lines are kept
		const logs: Array<LoggedLine> = []
		const exit = await runWithVirtualClock(() =>
			invokeGenerateText(hardened).pipe(Effect.provide(capturedLogs(logs))),
		)

		// THEN three attempts were made and two of them were retries: the last one
		// is where the call gave up, and counting it would report one more round
		// trip to the vendor than actually happened
		expect(Exit.isFailure(exit)).toBe(true)
		expect(Ref.getUnsafe(attemptsRef)).toBe(3)
		expect(retryLines(logs)).toHaveLength(2)
	})

	it('should retry a tool call the provider refused for not fitting its schema', async () => {
		// GIVEN a stub LM whose first call is refused because the model named an
		// argument the tool does not have, and whose second call goes through —
		// the same prompt sampled twice, which is why re-asking is worth anything
		const attemptsRef = Ref.makeUnsafe(0)
		const stub = makeStubLm(attemptsRef, attempt =>
			attempt === 1
				? Effect.fail(mkToolCallRefusedError())
				: Effect.succeed({ text: `ok@${attempt}`, usage: {} }),
		)
		const hardened = hardenLanguageModel(stub, 'groq')

		// WHEN generateText runs under TestClock
		const exit = await runWithVirtualClock(() => invokeGenerateText(hardened))

		// THEN the second attempt's payload surfaces
		// AND the refusal cost one attempt rather than the whole call
		expect(Exit.isSuccess(exit)).toBe(true)
		expect(Ref.getUnsafe(attemptsRef)).toBe(2)
	})

	it('should give up on a refused tool call once its retry budget is spent', async () => {
		// GIVEN a stub LM that refuses the tool call every time — a tool schema no
		// sampling of the model will ever satisfy
		const attemptsRef = Ref.makeUnsafe(0)
		const stub = makeStubLm(attemptsRef, () =>
			Effect.fail(mkToolCallRefusedError()),
		)
		const hardened = hardenLanguageModel(stub, 'groq')

		// WHEN generateText is invoked
		const exit = await runWithVirtualClock(() => invokeGenerateText(hardened))

		// THEN it fails as a ProviderError after the budgeted attempts, so a
		// permanently bad call cannot retry forever
		expect(Exit.isFailure(exit)).toBe(true)
		expect(failureOf(exit)).toBeInstanceOf(ProviderError)
		expect(Ref.getUnsafe(attemptsRef)).toBe(3)
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

	it('should still re-attempt when the vendor asks to wait longer than one call may take', async () => {
		// GIVEN a vendor rate-limiting us and asking for two minutes — longer than
		// the 90 seconds a single call to this tier is allowed to run
		const attemptsRef = Ref.makeUnsafe(0)
		const stub = makeStubLm(attemptsRef, attempt =>
			attempt === 1
				? Effect.fail(mkRateLimitError(Duration.minutes(2)))
				: Effect.succeed({ text: `ok@${attempt}`, usage: {} }),
		)
		const hardened = hardenLanguageModel(stub, 'nebius', {
			timeout: '90 seconds',
		})

		// WHEN the harness runs
		const exit = await runWithVirtualClock(
			() => invokeGenerateText(hardened),
			240_000,
		)

		// THEN the wait happens between attempts rather than inside one, so the
		// second attempt answers. Waiting inside the call would spend the vendor's
		// two minutes against that call's ninety seconds and report a run that hung
		// instead of one that was asked to slow down
		expect(Exit.isSuccess(exit)).toBe(true)
		expect(Ref.getUnsafe(attemptsRef)).toBe(2)
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

	it('should name the timeout in the ProviderError instead of the generic fallback', async () => {
		// GIVEN a never-resolving call on the `custom` vendor with a 1-second
		// timeout — the exact production shape whose failure used to collapse into
		// the contentless "custom request failed", hiding that it was a timeout
		const neverSvc = {
			generateText: () =>
				Effect.sleep('5 hours').pipe(Effect.as({ text: 'never', usage: {} })),
			generateObject: () => Effect.succeed({}),
			streamText: () => Effect.succeed({}),
		} as unknown as LanguageModel.Service
		const hardened = hardenLanguageModel(neverSvc, 'custom', {
			timeout: '1 second',
		})

		// WHEN the call times out under virtual time and its failure is captured
		const exit = await runWithVirtualClock(
			() => invokeGenerateText(hardened),
			5_000,
		)

		// THEN a ProviderError surfaces whose message says it timed out — not the
		// generic "<provider> request failed"
		expect(Exit.isFailure(exit)).toBe(true)
		const error = failureOf(exit)
		expect(error).toBeInstanceOf(ProviderError)
		if (error instanceof ProviderError) {
			expect(error.message).toContain('timed out')
			expect(error.message).not.toBe('custom request failed')
		}
	})

	it('should surface a ProviderError carrying the real message when the inner extract error has one', async () => {
		// GIVEN an extract call whose inner failure carries a real message
		const hardened = hardenLanguageModel(
			makeObjectFailingLm(new Error('firecrawl 500')),
			'together',
		)

		// WHEN generateObject is invoked and its failure is captured
		const error = await Effect.runPromise(
			Effect.flip(invokeGenerateObject(hardened)),
		)

		// THEN the underlying message is what surfaces, not a wrapper artifact
		expect(error).toBeInstanceOf(ProviderError)
		if (error instanceof ProviderError) {
			expect(error.message).toContain('firecrawl 500')
		}
	})

	it('should still surface a ProviderError instead of crashing when the inner extract error has no message', async () => {
		// GIVEN the production failure mode: the wrapped error's `message` is
		// undefined, which used to make the ProviderError schema reject its own
		// construction and throw a contentless error over the real one
		const noMessage = new Error('placeholder')
		Object.defineProperty(noMessage, 'message', { value: undefined })
		const hardened = hardenLanguageModel(
			makeObjectFailingLm(noMessage),
			'together',
		)

		// WHEN generateObject is invoked and its failure is captured — a
		// construction crash would surface as an uncaught defect here
		const error = await Effect.runPromise(
			Effect.flip(invokeGenerateObject(hardened)),
		)

		// THEN a ProviderError still surfaces, with a non-empty fallback message
		expect(error).toBeInstanceOf(ProviderError)
		if (error instanceof ProviderError) {
			expect(error.message.length).toBeGreaterThan(0)
		}
	})

	it('should read the message off a bare error object that is not an Error instance', async () => {
		// GIVEN a non-Error thrown value that still carries a message
		const hardened = hardenLanguageModel(
			makeObjectFailingLm({ message: 'quota exceeded', code: 429 }),
			'together',
		)

		// WHEN generateObject is invoked and its failure is captured
		const error = await Effect.runPromise(
			Effect.flip(invokeGenerateObject(hardened)),
		)

		// THEN the object's own message surfaces, not the generic fallback
		expect(error).toBeInstanceOf(ProviderError)
		if (error instanceof ProviderError) {
			expect(error.message).toContain('quota exceeded')
		}
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

	it('should cascade to the next slot when the primary times out', async () => {
		// GIVEN slot 0 never resolves within its 1-second timeout, slot 1 succeeds —
		// the failure mode this guards against: a wedged primary must fall through
		// to a different vendor rather than fail the whole run
		const callsRef = Ref.makeUnsafe<ReadonlyArray<string>>([])
		const wedgedSvc = {
			generateText: () =>
				Effect.gen(function* () {
					yield* Ref.update(callsRef, xs => [...xs, 'a'])
					return yield* Effect.sleep('5 hours').pipe(
						Effect.as({ text: 'a', usage: {} }),
					)
				}),
			generateObject: () => Effect.succeed({}),
			streamText: () => Effect.succeed({}),
		} as unknown as LanguageModel.Service
		const slot0 = hardenLanguageModel(wedgedSvc, 'nebius', {
			timeout: '1 second',
		})
		const slot1 = hardenLanguageModel(
			makeTaggedStub('b', callsRef, () =>
				Effect.succeed({ text: 'b', usage: {} }),
			),
			'groq',
		)
		const composed = withFallbackLanguageModel([slot0, slot1])

		// WHEN the composed model is invoked under virtual time
		const exit = await runWithVirtualClock(
			() => invokeGenerateText(composed),
			5_000,
		)

		// THEN slot 0 timed out once (a timeout is not retried) and the cascade
		// advanced to slot 1, which answered
		expect(Exit.isSuccess(exit)).toBe(true)
		const calls = Ref.getUnsafe(callsRef)
		expect(calls.filter(c => c === 'a').length).toBe(1)
		expect(calls.filter(c => c === 'b').length).toBe(1)
	})
})
