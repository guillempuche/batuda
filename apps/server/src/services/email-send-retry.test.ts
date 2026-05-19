import { Cause, Effect, Exit, Fiber, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'

import { retrySmtpSend, type SmtpSendFailed } from './email'

const extractFailure = <E>(cause: Cause.Cause<E>): E | null => {
	let found: E | null = null
	for (const reason of cause.reasons) {
		if (Cause.isFailReason(reason)) {
			found = reason.error
			break
		}
	}
	return found
}

// The retry policy is `Schedule.exponential('1 second', 2)` ⊓ `recurs(3)`,
// so the back-off pattern is 1s → 2s → 4s. TestClock lets us advance time
// deterministically without waiting ~7s in real seconds.

describe('retrySmtpSend', () => {
	describe('when SMTP fails transiently then recovers', () => {
		it('should resolve with the eventual success and call the underlying send 3 times', () =>
			Effect.gen(function* () {
				// GIVEN a transport that fails twice then succeeds
				const calls = yield* Ref.make(0)
				const send = Effect.gen(function* () {
					const n = yield* Ref.updateAndGet(calls, c => c + 1)
					if (n < 3) return yield* Effect.fail(new Error('ECONNRESET'))
					return { messageId: 'ok-1' }
				})

				// WHEN the retry-wrapped send is forked and the clock advances
				// through the 1s + 2s back-off windows
				const fiber = yield* Effect.forkChild(retrySmtpSend(send, 'inbox-test'))
				yield* TestClock.adjust('1 second')
				yield* TestClock.adjust('2 seconds')

				// THEN the program resolves with the success value
				const result = yield* Fiber.join(fiber)
				expect(result.messageId).toBe('ok-1')

				// AND the underlying send was called exactly 3 times
				expect(yield* Ref.get(calls)).toBe(3)
				// [apps/server/src/services/email.ts — smtpRetrySchedule recurs(3) bound]
			}).pipe(
				Effect.scoped,
				Effect.provide(TestClock.layer()),
				Effect.runPromise,
			))
	})

	describe('when SMTP fails on every attempt', () => {
		it('should surface SmtpSendFailed after exhausting the 3-retry budget', () =>
			Effect.gen(function* () {
				// GIVEN a transport that always fails with the same wire error
				const calls = yield* Ref.make(0)
				const send = Effect.gen(function* () {
					yield* Ref.update(calls, c => c + 1)
					return yield* Effect.fail(new Error('SMTP 421 too many connections'))
				})

				// WHEN the retry-wrapped send is forked and the clock advances
				// past every back-off window (1s + 2s + 4s = 7s)
				const fiber = yield* Effect.forkChild(
					Effect.exit(retrySmtpSend(send, 'inbox-test')),
				)
				yield* TestClock.adjust('10 seconds')

				// THEN the fiber exits with a typed SmtpSendFailed failure
				const exit = yield* Fiber.join(fiber)
				expect(Exit.isFailure(exit)).toBe(true)
				const failure = Exit.isFailure(exit) ? extractFailure(exit.cause) : null
				expect(failure?._tag).toBe('SmtpSendFailed')
				expect((failure as SmtpSendFailed).inboxId).toBe('inbox-test')

				// AND the underlying send was called 4 times (1 initial + 3 retries)
				expect(yield* Ref.get(calls)).toBe(4)
				// [apps/server/src/services/email.ts — retrySmtpSend mapError → SmtpSendFailed]
			}).pipe(
				Effect.scoped,
				Effect.provide(TestClock.layer()),
				Effect.runPromise,
			))
	})

	describe('when send succeeds on the first attempt', () => {
		it('should call the transport exactly once and never sleep', () =>
			Effect.gen(function* () {
				// GIVEN a transport that succeeds immediately
				const calls = yield* Ref.make(0)
				const send = Effect.gen(function* () {
					yield* Ref.update(calls, c => c + 1)
					return { messageId: 'happy-path' }
				})

				// WHEN the retry-wrapped send runs without any clock advance
				const result = yield* retrySmtpSend(send, 'inbox-test')

				// THEN it resolves immediately with the happy-path messageId
				expect(result.messageId).toBe('happy-path')

				// AND no retry fired
				expect(yield* Ref.get(calls)).toBe(1)
				// [apps/server/src/services/email.ts — retrySmtpSend happy path]
			}).pipe(
				Effect.scoped,
				Effect.provide(TestClock.layer()),
				Effect.runPromise,
			))
	})
})
