import { Cause, Effect, Exit, Fiber, Option, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'

import { ProviderError } from '../domain/errors'
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
