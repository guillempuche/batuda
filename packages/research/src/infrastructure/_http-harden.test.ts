import {
	Cause,
	Effect,
	Exit,
	Fiber,
	type Layer,
	Logger,
	Option,
	Ref,
	References,
} from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'

import { ProviderError, UnsupportedSite } from '../domain/errors'
import { hardenHttp } from './_http-harden'

// ── Test helpers ──

/**
 * Run a program with `TestClock` installed and tick virtual time forward in
 * small increments until the fiber settles — the same harness `_harden.test.ts`
 * uses, because jittered retry registers a fresh sleep deadline after each wake
 * and a single large `adjust` can race past it.
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

const errorOf = (
	exit: Exit.Exit<unknown, ProviderError>,
): ProviderError | undefined =>
	Exit.isFailure(exit)
		? Option.getOrUndefined(Cause.findErrorOption(exit.cause))
		: undefined

const recoverable = (message: string): ProviderError =>
	new ProviderError({ provider: 'test', message, recoverable: true })

const fatal = (message: string): ProviderError =>
	new ProviderError({ provider: 'test', message, recoverable: false })

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

const retryLines = (lines: ReadonlyArray<LoggedLine>) =>
	lines.filter(line => line.message === 'provider.retry')

// An inner HTTP effect that counts its invocations through a Ref, so retry
// assertions hold even though each attempt re-runs the whole effect.
const countingInner = (
	callsRef: Ref.Ref<number>,
	impl: (attempt: number) => Effect.Effect<string, ProviderError>,
): Effect.Effect<string, ProviderError> =>
	Effect.gen(function* () {
		const n = yield* Ref.updateAndGet(callsRef, x => x + 1)
		return yield* impl(n)
	})

describe('hardenHttp', () => {
	it('should return the value on first success without retrying', async () => {
		// GIVEN an inner call that succeeds immediately
		const callsRef = Ref.makeUnsafe(0)
		const inner = countingInner(callsRef, () => Effect.succeed('ok'))

		// WHEN it runs through the hardener
		const exit = await runWithVirtualClock(() => hardenHttp('test')(inner))

		// THEN the value surfaces AND the inner ran exactly once
		expect(exit).toStrictEqual(Exit.succeed('ok'))
		expect(Ref.getUnsafe(callsRef)).toBe(1)
	})

	it('should retry recoverable failures and surface a later success', async () => {
		// GIVEN two recoverable failures followed by a success
		const callsRef = Ref.makeUnsafe(0)
		const inner = countingInner(callsRef, attempt =>
			attempt <= 2 ? Effect.fail(recoverable('503')) : Effect.succeed('ok'),
		)

		// WHEN it runs through the hardener under virtual time
		const exit = await runWithVirtualClock(() => hardenHttp('test')(inner))

		// THEN the third attempt's value surfaces AND three attempts fired
		expect(exit).toStrictEqual(Exit.succeed('ok'))
		expect(Ref.getUnsafe(callsRef)).toBe(3)
	})

	it('should stop after the max attempts when every try is recoverable', async () => {
		// GIVEN an inner call that always fails recoverably
		const callsRef = Ref.makeUnsafe(0)
		const inner = countingInner(callsRef, () => Effect.fail(recoverable('503')))

		// WHEN it runs through the hardener
		const exit = await runWithVirtualClock(() => hardenHttp('test')(inner))

		// THEN it fails after exactly three attempts (1 initial + 2 retries)
		// AND the surfaced error is still the recoverable ProviderError
		expect(Ref.getUnsafe(callsRef)).toBe(3)
		expect(errorOf(exit)?.recoverable).toBe(true)
		expect(errorOf(exit)?.provider).toBe('test')
	})

	it('should fail fast on a non-recoverable error without retrying', async () => {
		// GIVEN an inner call that fails with recoverable:false
		const callsRef = Ref.makeUnsafe(0)
		const inner = countingInner(callsRef, () => Effect.fail(fatal('401')))

		// WHEN it runs through the hardener
		const exit = await runWithVirtualClock(() => hardenHttp('test')(inner))

		// THEN it fails on the first attempt with no retry
		expect(Ref.getUnsafe(callsRef)).toBe(1)
		expect(errorOf(exit)?.recoverable).toBe(false)
	})

	it('should stay quiet about retrying when it did not retry', async () => {
		// GIVEN a vendor refusing the key, which asking again will never fix
		const callsRef = Ref.makeUnsafe(0)
		const inner = countingInner(callsRef, () => Effect.fail(fatal('401')))

		// WHEN it runs through the hardener and its log lines are kept
		const logs: Array<LoggedLine> = []
		await runWithVirtualClock(() =>
			hardenHttp('firecrawl')(inner).pipe(Effect.provide(capturedLogs(logs))),
		)

		// THEN nothing claims a retry: a 4xx from any vendor reached through here —
		// web search, page fetch, register lookup, contact enrichment — would
		// otherwise read as a vendor having a bad minute
		expect(Ref.getUnsafe(callsRef)).toBe(1)
		expect(retryLines(logs)).toHaveLength(0)
	})

	it('should record only the retries it made, under the field they are read by', async () => {
		// GIVEN a vendor failing recoverably every time, so the call uses up every
		// attempt it is allowed
		const callsRef = Ref.makeUnsafe(0)
		const inner = countingInner(callsRef, () => Effect.fail(recoverable('503')))

		// WHEN it runs through the hardener and its log lines are kept
		const logs: Array<LoggedLine> = []
		await runWithVirtualClock(() =>
			hardenHttp('firecrawl')(inner).pipe(Effect.provide(capturedLogs(logs))),
		)

		// THEN three attempts were made and two of them were retries, each naming
		// the vendor — the last attempt is where the call gave up, and counting it
		// would report one more round trip than actually happened
		expect(Ref.getUnsafe(callsRef)).toBe(3)
		expect(retryLines(logs)).toHaveLength(2)
		expect(retryLines(logs)[0]?.annotations).toMatchObject({
			event: 'provider.retried',
			provider: 'firecrawl',
		})
	})

	it('should pass a non-ProviderError routing error straight through, un-retried', async () => {
		// GIVEN an inner call that fails with a routing error that is NOT a
		// ProviderError — the scrape provider refusing an unsupported site
		const callsRef = Ref.makeUnsafe(0)
		const inner = Effect.gen(function* () {
			yield* Ref.update(callsRef, x => x + 1)
			return yield* Effect.fail(
				new UnsupportedSite({
					provider: 'firecrawl',
					url: 'https://www.linkedin.com/company/x',
				}),
			)
		})

		// WHEN it runs through the hardener and its log lines are kept
		const logs: Array<LoggedLine> = []
		const exit = await runWithVirtualClock(() =>
			hardenHttp('test')(inner).pipe(Effect.provide(capturedLogs(logs))),
		)

		// THEN it fails on the first attempt (no retry) and keeps its identity —
		// never re-cast to a recoverable "timed out" ProviderError — and no retry
		// is claimed for it: a site the provider refuses is routine traffic, not a
		// vendor in trouble
		expect(Ref.getUnsafe(callsRef)).toBe(1)
		const err = Exit.isFailure(exit)
			? Option.getOrUndefined(Cause.findErrorOption(exit.cause))
			: undefined
		expect(err).toBeInstanceOf(UnsupportedSite)
		expect(retryLines(logs)).toHaveLength(0)
	})

	it('should convert a timed-out attempt into a recoverable error and retry', async () => {
		// GIVEN an inner call that never resolves, under a short per-attempt timeout
		const callsRef = Ref.makeUnsafe(0)
		const inner = countingInner(callsRef, () =>
			Effect.flatMap(Effect.void, () => Effect.never),
		)

		// WHEN it runs through a hardener with a 1s timeout
		const exit = await runWithVirtualClock(() =>
			hardenHttp('test', { timeout: '1 second' })(inner),
		)

		// THEN each attempt times out and retries, exhausting the budget
		// AND the surfaced error is a recoverable "timed out" ProviderError
		expect(Ref.getUnsafe(callsRef)).toBe(3)
		expect(errorOf(exit)?.recoverable).toBe(true)
		expect(errorOf(exit)?.message).toContain('timed out')
	})
})
