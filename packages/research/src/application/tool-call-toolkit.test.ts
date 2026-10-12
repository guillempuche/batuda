import { Effect, Exit, Layer, Stream } from 'effect'
import { describe, expect, it } from 'vitest'

import { StubRegistryEsProvider } from '../infrastructure/stub/registry-es'
import { StubScrapeProvider } from '../infrastructure/stub/scrape'
import { StubSearchProvider } from '../infrastructure/stub/search'
import { ContactDiscovery } from './contact-discovery'
import { Budget, ResearchRunContext } from './ports'
import { researchToolkit, researchToolkitLayer } from './tools'

// ── Test harness ──
// Everything a toolkit handler needs. None of it is reached by these tests — a
// call refused over its name or its arguments is turned away before any handler
// runs — but the toolkit layer will not build without it.

const stubBudget = Layer.succeed(Budget)(
	Budget.of({
		chargeCheap: () => Effect.void,
		chargePaid: () => Effect.succeed(true),
		withPaidCharge: () => call =>
			Effect.map(Effect.suspend(call), value => ({
				_tag: 'bought' as const,
				value,
			})),
		vendorsRefused: () => Effect.succeed([]),
		snapshot: () =>
			Effect.succeed({
				cheapBudget: 1000,
				cheapSpent: 0,
				cheapRemaining: 1000,
				paidBudget: 1000,
				paidSpent: 0,
				paidRemaining: 1000,
			}),
	}),
)

const testInfra = Layer.mergeAll(
	stubBudget,
	Layer.succeed(ResearchRunContext)({ researchId: 'test-run' }),
	Layer.succeed(ContactDiscovery)({
		discover: () =>
			Effect.succeed({
				status: 'no_reliable_contact' as const,
				researchId: 'test-run',
			}),
	}),
	StubSearchProvider,
	StubScrapeProvider,
	StubRegistryEsProvider,
)

// Drive one tool call through the real toolkit and hand back whatever it
// produced — the results it streamed, or the failure that ended it.
const callTool = (name: string, params: unknown) =>
	Effect.runPromiseExit(
		Effect.gen(function* () {
			const toolkit = yield* researchToolkit
			const stream = yield* toolkit.handle(name as never, params as never)
			return yield* Stream.runCollect(stream)
		}).pipe(
			Effect.provide(researchToolkitLayer.pipe(Layer.provide(testInfra))),
		),
	)

// The call the failing production run actually wrote: two argument names the
// tool does not have, and three of its own left out.
const BAD_WEB_SEARCH = { query: 'ferreteria girona', topn: 5, source: 'web' }

const resultsOf = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isSuccess(exit)
		? (Array.from(exit.value as Iterable<unknown>) as ReadonlyArray<{
				result: { status?: string; tool?: string; message?: string }
				isFailure: boolean
				encodedResult: unknown
			}>)
		: []

describe('researchToolkit', () => {
	describe('when the model writes arguments the tool does not take', () => {
		it('should answer the model instead of ending the round', async () => {
			// GIVEN the arguments the failing run wrote
			// WHEN the call is made
			const exit = await callTool('web_search', { ...BAD_WEB_SEARCH })

			// THEN the round survives, and what comes back is a tool result marked
			// as a failure — the same shape a dead page or an out-of-credit register
			// already comes back as, so the model reads it the way it reads those
			expect(Exit.isSuccess(exit)).toBe(true)
			const results = resultsOf(exit)
			expect(results).toHaveLength(1)
			expect(results[0]?.isFailure).toBe(true)
		})

		it('should hand the provider a result naming the tool and the objection', async () => {
			// GIVEN the same call
			// WHEN the call is made
			const exit = await callTool('web_search', { ...BAD_WEB_SEARCH })

			// THEN the encoded copy is plain JSON — it rides back to the vendor in
			// the next request — and says which tool refused what
			const encoded = JSON.stringify(resultsOf(exit)[0]?.encodedResult)
			expect(encoded).toContain('ToolParameterValidationError')
			expect(encoded).toContain('web_search')
		})
	})

	describe('when the model names a tool that does not exist', () => {
		it('should refuse it with the tools it can actually call', async () => {
			// GIVEN a call to a tool the toolkit does not hold
			// WHEN the call is made
			const exit = await callTool('web_lookup', { query: 'x' })

			// THEN the round fails with the real list, which is what the run's
			// correction after a failed round puts to the model
			expect(Exit.isFailure(exit)).toBe(true)
			expect(JSON.stringify(exit)).toContain('ToolNotFoundError')
		})
	})

	describe('when the model writes a call the tool does take', () => {
		it('should run the handler and return its answer', async () => {
			// GIVEN a well-formed web_search call
			// WHEN the call is made
			const exit = await callTool('web_search', {
				query: 'ferreteria girona',
				limit: null,
				recency_days: null,
				country: null,
			})

			// THEN the handler ran and its answer comes back as a success
			expect(Exit.isSuccess(exit)).toBe(true)
			const results = resultsOf(exit)
			expect(results[0]?.isFailure).toBe(false)
			expect(results[0]?.result.status).toBeUndefined()
		})
	})
})
