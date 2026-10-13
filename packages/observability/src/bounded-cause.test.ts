import { Cause, Effect, Exit, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { boundedCause, readableError } from './bounded-cause'

class Quote extends Schema.Class<Quote>('Quote')({
	amount: Schema.Number.check(Schema.isGreaterThan(0)),
}) {}

// What building a value that breaks its schema throws.
const brokenConstruction = (): unknown => {
	try {
		new Quote({ amount: -1 })
	} catch (error) {
		return error
	}
	throw new Error('expected building the value to throw')
}

describe('boundedCause', () => {
	describe('when a crash comes from building a value that breaks its schema', () => {
		it('should name the field and what it expected, not dump the schema', () => {
			// GIVEN a crash thrown by building a quote with a negative amount
			const cause = Cause.die(brokenConstruction())

			// WHEN it is rendered for the log
			const text = boundedCause(cause)

			// THEN the line says which field failed and why, and leaves out the
			// internals that would otherwise fill the length the log allows
			expect(text).toContain('Expected a value greater than 0')
			expect(text).toContain('["amount"]')
			expect(text).not.toContain('~effect/SchemaIssue')
		})

		it('should keep the span the crash happened in', async () => {
			// GIVEN the same crash, raised inside a named span
			const exit = await Effect.runPromiseExit(
				Effect.sync(() => new Quote({ amount: -1 })).pipe(
					Effect.withSpan('quote.build'),
				),
			)
			if (!Exit.isFailure(exit)) throw new Error('expected the build to fail')

			// WHEN it is rendered for the log
			const text = boundedCause(exit.cause)

			// THEN the span still points at where it happened
			expect(text).toContain('quote.build')
			expect(text).toContain('Expected a value greater than 0')
		})
	})

	describe('when the schema failure arrives wrapped in another error', () => {
		it('should still spell it out, as Effect.try delivers it', async () => {
			// GIVEN the same broken construction run through Effect.try, which
			// fails with an UnknownError carrying the thrown error as its cause
			const exit = await Effect.runPromiseExit(
				Effect.try(() => new Quote({ amount: -1 })),
			)
			if (!Exit.isFailure(exit)) throw new Error('expected the build to fail')

			// WHEN it is rendered for the log
			const text = boundedCause(exit.cause)

			// THEN the wrapper is still named, and the failure underneath it says
			// what it expected instead of dumping the schema
			expect(text).toContain('UnknownError')
			expect(text).toContain('Expected a value greater than 0')
			expect(text).not.toContain('~effect/SchemaIssue')
		})
	})

	describe('when the chain of causes under a crash loops back on itself', () => {
		it('should still log the crash, without the loop', () => {
			// GIVEN an error that is, a step down, its own cause — which the
			// printer follows forever
			const first = new Error('first')
			const second = new Error('second', { cause: first })
			Object.defineProperty(first, 'cause', { value: second })

			// WHEN it is rendered for the log
			const text = boundedCause(Cause.die(first))

			// THEN the crash is named instead of the logger itself throwing
			expect(text).toContain('first')
			expect(text).toContain('loop back on themselves')
		})
	})

	describe('when a schema message carries replacement patterns', () => {
		it('should keep them as written', () => {
			// GIVEN a failed check whose expectation quotes a pattern with `$'` in it
			class Code extends Schema.Class<Code>('Code')({
				value: Schema.String.check(Schema.isPattern(/^a$'x/u)),
			}) {}
			let thrown: unknown
			try {
				new Code({ value: 'zz' })
			} catch (error) {
				thrown = error
			}

			// WHEN it is made readable
			const readable = readableError(thrown) as Error

			// THEN the stack's first line carries the pattern whole, not cut at `$'`
			expect(readable.stack?.split('\n')[0]).toContain("^a$'x")
		})
	})

	describe('when a crash is any other error', () => {
		it('should render it exactly as before', () => {
			// GIVEN an ordinary crash
			const cause = Cause.die(new Error('the disk is full'))

			// WHEN it is rendered for the log
			// THEN nothing about it changed
			expect(boundedCause(cause)).toBe(Cause.pretty(cause))
		})
	})

	describe('when the rendered cause is longer than a log line can carry', () => {
		it('should cut it and say how much was left out', () => {
			// GIVEN a crash whose message alone is far past the limit
			const cause = Cause.die(new Error('x'.repeat(10_000)))

			// WHEN it is rendered for the log
			const text = boundedCause(cause)

			// THEN it stops at the limit and counts what it dropped
			expect(text.length).toBeLessThan(4100)
			expect(text).toMatch(/… \(\d+ more characters\)$/)
		})
	})
})

describe('readableError', () => {
	describe('when given anything but a failed schema check', () => {
		it('should hand back the very same value', () => {
			// GIVEN an ordinary error and a value that is not an error at all
			const ordinary = new Error('nope')

			// WHEN each is made readable
			// THEN each comes back untouched
			expect(readableError(ordinary)).toBe(ordinary)
			expect(readableError('a string')).toBe('a string')
		})
	})

	describe('when the chain of causes under an error loops back on itself', () => {
		it('should stop looking rather than follow the loop forever', () => {
			// GIVEN an error that is, a step down, its own cause
			const first = new Error('first')
			const second = new Error('second', { cause: first })
			Object.defineProperty(first, 'cause', { value: second })

			// WHEN it is made readable
			// THEN the very same error comes back
			expect(readableError(first)).toBe(first)
		})
	})

	describe('when given a failed schema check', () => {
		it('should put what failed into the message', () => {
			// GIVEN the error a broken construction throws
			const thrown = brokenConstruction()

			// WHEN it is made readable
			const readable = readableError(thrown)

			// THEN its message carries the field and the expectation
			expect(readable).toBeInstanceOf(Error)
			expect((readable as Error).message).toContain(
				'Expected a value greater than 0',
			)
		})
	})
})
