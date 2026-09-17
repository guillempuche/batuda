import { Effect, Exit, Layer, Stream } from 'effect'
import { describe, expect, it } from 'vitest'

import { StubRegistryEsProvider } from '../infrastructure/stub/registry-es'
import { StubScrapeProvider } from '../infrastructure/stub/scrape'
import { StubSearchProvider } from '../infrastructure/stub/search'
import { ContactDiscovery } from './contact-discovery'
import { Budget, ResearchRunContext } from './ports'
import { toolkitAnsweringBadCalls } from './tool-call-correction'
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

// Drive one tool call through the real toolkit, wrapped or bare, and hand back
// whatever it produced — the results it streamed, or the failure that ended it.
const callTool = (
	options: { readonly wrapped: boolean },
	name: string,
	params: unknown,
) =>
	Effect.runPromiseExit(
		Effect.gen(function* () {
			const built = yield* researchToolkit
			const toolkit = options.wrapped ? toolkitAnsweringBadCalls(built) : built
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

describe('toolkitAnsweringBadCalls', () => {
	describe('when the model writes arguments the tool does not take', () => {
		it('should end the round when the toolkit is used bare', async () => {
			// GIVEN the real toolkit, unwrapped, and the arguments the failing run
			// wrote
			// WHEN the call is made
			const exit = await callTool({ wrapped: false }, 'web_search', {
				...BAD_WEB_SEARCH,
			})

			// THEN it fails outright — the bare toolkit turns one fumbled call into
			// the end of the round, which is what the wrapper below exists to stop
			expect(Exit.isFailure(exit)).toBe(true)
		})

		it('should answer the model instead of ending the round', async () => {
			// GIVEN the same call through the wrapped toolkit
			// WHEN the call is made
			const exit = await callTool({ wrapped: true }, 'web_search', {
				...BAD_WEB_SEARCH,
			})

			// THEN the round survives, and what comes back is a tool result marked
			// as a failure — the same shape a dead page or an out-of-credit register
			// already comes back as, so the model reads it the way it reads those
			expect(Exit.isSuccess(exit)).toBe(true)
			const results = resultsOf(exit)
			expect(results).toHaveLength(1)
			expect(results[0]?.isFailure).toBe(true)
			expect(results[0]?.result.status).toBe('invalid_arguments')
			expect(results[0]?.result.tool).toBe('web_search')
		})

		it('should tell the model what the tool really accepts', async () => {
			// GIVEN the same wrapped call
			// WHEN the call is made
			const exit = await callTool({ wrapped: true }, 'web_search', {
				...BAD_WEB_SEARCH,
			})

			// THEN the result carries every argument web_search takes, so the model
			// has what it needs to write the call properly on its next turn rather
			// than guessing at the same names again
			const message = resultsOf(exit)[0]?.result.message ?? ''
			for (const name of ['query', 'limit', 'recency_days', 'country']) {
				expect(message).toContain(name)
			}
		})

		it('should hand the provider a result it can send back', async () => {
			// GIVEN the same wrapped call
			// WHEN the call is made
			const exit = await callTool({ wrapped: true }, 'web_search', {
				...BAD_WEB_SEARCH,
			})

			// THEN the encoded copy is plain JSON — it rides back to the vendor in
			// the next request, so anything that would not serialise would break the
			// round it is meant to save
			const encoded = resultsOf(exit)[0]?.encodedResult
			expect(() => JSON.stringify(encoded)).not.toThrow()
			expect(JSON.parse(JSON.stringify(encoded))).toMatchObject({
				status: 'invalid_arguments',
				tool: 'web_search',
			})
		})
	})

	describe('when the model names a tool that does not exist', () => {
		it('should answer with the tools it can actually call', async () => {
			// GIVEN a call to a tool the toolkit does not hold
			// WHEN the call is made through the wrapped toolkit
			const exit = await callTool({ wrapped: true }, 'web_lookup', {
				query: 'x',
			})

			// THEN the model is told so and given the real list, instead of the run
			// ending on a name it invented
			expect(Exit.isSuccess(exit)).toBe(true)
			const result = resultsOf(exit)[0]?.result as {
				status?: string
				available_tools?: ReadonlyArray<string>
			}
			expect(result.status).toBe('no_such_tool')
			expect(result.available_tools).toContain('web_search')
		})
	})

	describe('when the model writes a call the tool does take', () => {
		it('should leave the real result alone', async () => {
			// GIVEN a well-formed web_search call
			// WHEN it goes through the wrapped toolkit
			const exit = await callTool({ wrapped: true }, 'web_search', {
				query: 'ferreteria girona',
				limit: null,
				recency_days: null,
				country: null,
			})

			// THEN the handler ran and its answer comes back untouched — the wrapper
			// only ever speaks for a call that never reached a handler
			expect(Exit.isSuccess(exit)).toBe(true)
			const results = resultsOf(exit)
			expect(results[0]?.isFailure).toBe(false)
			expect(results[0]?.result.status).toBeUndefined()
		})
	})
})
