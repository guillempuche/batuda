import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { makeUsageMeter } from './usage-meter'

describe('the record of what a run spent', () => {
	describe('when many calls each cost a sliver of a cent', () => {
		it('should add them up before rounding, not round each one away', async () => {
			// GIVEN a thousand model calls, each worth four thousandths of a cent
			const snapshot = await Effect.runPromise(
				Effect.gen(function* () {
					const meter = yield* makeUsageMeter
					for (let i = 0; i < 1000; i++) {
						yield* meter.recordLlm({
							tier: 'agent',
							model: 'a-model',
							provider: 'a-vendor',
							tokensIn: 10,
							tokensOut: 5,
							microcents: 4000,
						})
					}

					// WHEN the total is taken
					return yield* meter.snapshot()
				}),
			)

			// THEN they amount to four cents — rounding each call on its own would
			// have recorded the whole run as free
			expect(snapshot.costCents).toBe(4)
			expect(snapshot.tokensIn).toBe(10_000)
			expect(snapshot.tokensOut).toBe(5000)
		})
	})

	describe('when a tier falls back to its second vendor', () => {
		it('should count the two apart even where they serve one model name', async () => {
			// GIVEN one tier answered twice by the primary vendor and once by the
			//   fallback, both serving a model under the same name — which is what
			//   the extract tier's two slots do
			const snapshot = await Effect.runPromise(
				Effect.gen(function* () {
					const meter = yield* makeUsageMeter
					for (const provider of ['nebius', 'nebius', 'fireworks']) {
						yield* meter.recordLlm({
							tier: 'extract',
							model: 'gpt-oss-120b',
							provider,
							tokensIn: 10,
							tokensOut: 5,
							microcents: 1000,
						})
					}
					return yield* meter.snapshot()
				}),
			)

			// THEN the tally names the vendor beside the model, so a run that fell
			//   back says so. Keyed on the model alone the three calls collapse into
			//   one entry, and nothing in a finished run distinguishes an answer from
			//   the primary from one the fallback gave — which matters because the
			//   two do not judge alike.
			expect(snapshot.callsByModel).toEqual({
				'extract@nebius:gpt-oss-120b': 2,
				'extract@fireworks:gpt-oss-120b': 1,
			})
		})
	})

	describe('when several kinds of work were charged', () => {
		it('should keep each kind apart, and credits by provider', async () => {
			// GIVEN model calls on two tiers and a search that consumed credits
			const snapshot = await Effect.runPromise(
				Effect.gen(function* () {
					const meter = yield* makeUsageMeter
					yield* meter.recordLlm({
						tier: 'agent',
						model: 'a-model',
						provider: 'a-vendor',
						tokensIn: 100,
						tokensOut: 50,
						microcents: 2_000_000,
					})
					yield* meter.recordLlm({
						tier: 'writer',
						model: 'w-model',
						provider: 'a-vendor',
						tokensIn: 20,
						tokensOut: 80,
						microcents: 1_000_000,
					})
					yield* meter.recordUnits({
						provider: 'firecrawl',
						port: 'search',
						units: 7,
						microcents: 500_000,
					})

					// WHEN the total is taken
					return yield* meter.snapshot()
				}),
			)

			// THEN the parts are separable and the credits are attributed
			expect(snapshot.costCents).toBe(4)
			expect(snapshot.costByBucket).toEqual({
				llm_agent: 2,
				llm_writer: 1,
				search: 0.5,
			})
			expect(snapshot.unitsByProvider).toEqual({ firecrawl_search: 7 })
		})
	})

	describe('when a run picks up where an earlier attempt stopped', () => {
		it('should add to what that attempt already spent', async () => {
			// GIVEN a run resuming after an attempt that cost 30, having read 900
			// tokens and written 400
			const snapshot = await Effect.runPromise(
				Effect.gen(function* () {
					const meter = yield* makeUsageMeter
					yield* meter.seed(30, 900, 400)
					yield* meter.recordLlm({
						tier: 'extract',
						model: 'x-model',
						provider: 'a-vendor',
						tokensIn: 100,
						tokensOut: 50,
						microcents: 5_000_000,
					})

					// WHEN the total is taken
					return yield* meter.snapshot()
				}),
			)

			// THEN this attempt's spend is added to the earlier one, not swapped for it
			expect(snapshot.costCents).toBe(35)
			expect(snapshot.tokensIn).toBe(1000)
			expect(snapshot.tokensOut).toBe(450)
		})
	})

	describe('when nothing was charged', () => {
		it('should report a run that cost nothing', async () => {
			// GIVEN a run that reached no provider — every answer came from the cache
			const snapshot = await Effect.runPromise(
				makeUsageMeter.pipe(Effect.flatMap(meter => meter.snapshot())),
			)

			// WHEN the total is taken
			// THEN it is zero, with nothing to break down
			expect(snapshot.costCents).toBe(0)
			expect(snapshot.tokensIn).toBe(0)
			expect(snapshot.costByBucket).toEqual({})
			expect(snapshot.unitsByProvider).toEqual({})
		})
	})
})
