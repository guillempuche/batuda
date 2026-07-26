import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { type GuardLink, runGuardChain } from './guard-chain'

// A link that appends its own name to a list of findings, so the order the chain
// ran the links in is readable straight off the result.
const appending = (name: string): GuardLink => ({
	name,
	run: findings =>
		Effect.succeed({ findings: [...(findings as string[]), name] }),
})

describe('runGuardChain', () => {
	describe('when the chain has several links', () => {
		it('should run them in array order, each seeing what the last one kept', () =>
			Effect.gen(function* () {
				// GIVEN three links that each record having run
				const chain = [appending('a'), appending('b'), appending('c')]

				// WHEN the chain runs
				const result = yield* runGuardChain(chain, [])

				// THEN each link saw its predecessor's output, in the array's order
				expect(result.findings).toEqual(['a', 'b', 'c'])
			}).pipe(Effect.runPromise))
	})

	describe('when a link drops everything', () => {
		it('should carry the emptied findings into the links after it', () =>
			Effect.gen(function* () {
				// GIVEN a link that discards its input, ahead of one that records
				const emptying: GuardLink = {
					name: 'empty',
					run: () => Effect.succeed({ findings: [] }),
				}

				// WHEN the chain runs
				const result = yield* runGuardChain(
					[appending('a'), emptying, appending('c')],
					[],
				)

				// THEN the later link worked from the emptied findings, not the original
				expect(result.findings).toEqual(['c'])
			}).pipe(Effect.runPromise))
	})

	describe('when links report span attributes', () => {
		it('should merge them all into one set for the phase span', () =>
			Effect.gen(function* () {
				// GIVEN two links that each contribute their own attributes
				const reporting = (
					name: string,
					spanCounts: Record<string, number>,
				): GuardLink => ({
					name,
					run: findings => Effect.succeed({ findings, spanCounts }),
				})

				// WHEN the chain runs
				const result = yield* runGuardChain(
					[
						reporting('first', { 'research.a': 1 }),
						reporting('second', { 'research.b': 2 }),
					],
					null,
				)

				// THEN the phase sees every link's attributes together
				expect(result.spanCounts).toEqual({ 'research.a': 1, 'research.b': 2 })
			}).pipe(Effect.runPromise))
	})

	describe('when two links report the same span attribute', () => {
		it('should keep the later value, since it reflects the later state', () =>
			Effect.gen(function* () {
				// GIVEN two links reporting the same key
				const reporting = (value: number): GuardLink => ({
					name: `kept-${value}`,
					run: findings =>
						Effect.succeed({
							findings,
							spanCounts: { 'research.kept': value },
						}),
				})

				// WHEN the chain runs
				const result = yield* runGuardChain([reporting(9), reporting(4)], null)

				// THEN the last writer wins
				expect(result.spanCounts).toEqual({ 'research.kept': 4 })
			}).pipe(Effect.runPromise))
	})

	describe('when the chain is empty', () => {
		it('should hand back the findings untouched, with nothing reported', () =>
			Effect.gen(function* () {
				// GIVEN no links at all — every guard skipped for this run's shape
				const findings = { enrichment: { industry: 'transport' } }

				// WHEN the chain runs
				const result = yield* runGuardChain([], findings)

				// THEN the findings pass straight through
				expect(result.findings).toBe(findings)
				expect(result.spanCounts).toEqual({})
			}).pipe(Effect.runPromise))
	})
})
