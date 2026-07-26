import { Effect, Stream } from 'effect'
import { LanguageModel } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'
import { describe, expect, it } from 'vitest'

import { makeUsageMeter, UsageMeter } from '../application/usage-meter'
import {
	computeLlmCacheKey,
	isLlmCacheable,
	makeCachedLanguageModel,
	rehydrateCachedResponse,
	stableStringifyForCache,
} from './cached-llm'

describe('llm cache key computation', () => {
	it('should produce stable keys across equivalent but reordered options', () => {
		// GIVEN two option objects with the same fields in different orders
		const a = computeLlmCacheKey('agent', 'qwen3-397b', 'text', {
			prompt: 'hi',
			temperature: 0,
			max_tokens: 100,
		})
		const b = computeLlmCacheKey('agent', 'qwen3-397b', 'text', {
			max_tokens: 100,
			temperature: 0,
			prompt: 'hi',
		})

		// THEN the two keys collide — stable-stringify canonicalizes the order
		expect(a).toBe(b)
	})

	it('should key by (tier, model, method) so distinct callers do not collide', () => {
		// GIVEN identical options sent to different tiers and methods
		const opts = { prompt: 'x', temperature: 0 }
		const agentText = computeLlmCacheKey('agent', 'm1', 'text', opts)
		const agentObj = computeLlmCacheKey('agent', 'm1', 'object', opts)
		const extractText = computeLlmCacheKey('extract', 'm1', 'text', opts)
		const modelSwap = computeLlmCacheKey('agent', 'm2', 'text', opts)

		// THEN every variation produces a distinct key
		const keys = new Set([agentText, agentObj, extractText, modelSwap])
		expect(keys.size).toBe(4)
	})

	it('should skip the cache when temperature is non-zero', () => {
		// GIVEN a request with temperature 0.7
		// THEN the cache gate returns false — temp>0 bypasses the cache entirely
		expect(isLlmCacheable({ prompt: 'x', temperature: 0.7 })).toBe(false)
		expect(isLlmCacheable({ prompt: 'x', temperature: 1 })).toBe(false)
	})

	it('should cache deterministic calls (temperature 0 or omitted)', () => {
		// GIVEN temperature 0 or missing
		// THEN the cache gate returns true — deterministic calls are safe to reuse
		expect(isLlmCacheable({ prompt: 'x', temperature: 0 })).toBe(true)
		expect(isLlmCacheable({ prompt: 'x' })).toBe(true)
	})

	it('should honor an explicit cacheable:false opt-out', () => {
		// GIVEN a caller that embeds Date.now() or PII in the prompt
		// AND marks the call as cacheable:false
		// THEN the cache is skipped even at temperature 0
		expect(
			isLlmCacheable({ prompt: 'x', temperature: 0, cacheable: false }),
		).toBe(false)
	})

	it('should treat primitives and null as trivially cacheable', () => {
		// GIVEN non-object inputs
		// THEN the gate defaults to cacheable — only object options can opt out
		expect(isLlmCacheable(null)).toBe(true)
		expect(isLlmCacheable(undefined)).toBe(true)
		expect(isLlmCacheable('raw-prompt')).toBe(true)
	})
})

describe('fallback slot cache keying', () => {
	describe('when a tier answers from a fallback slot on a different model', () => {
		it('should key every slot on the tier primary model so one answer is shared across slots', () => {
			// GIVEN one extract tier whose primary is the Nebius 235B and whose
			// fallback slot answers as a different vendor's model
			const primaryModel = 'Qwen/Qwen3-235B-A22B-Instruct-2507'
			const answeringModel = 'accounts/fireworks/models/gpt-oss-120b'
			const opts = { prompt: 'enrich Acme Ltd', temperature: 0 }

			// WHEN the key is computed the way every slot computes it — always from
			// the tier's primary model, never from whichever model answered
			const primarySlotKey = computeLlmCacheKey(
				'extract',
				primaryModel,
				'object',
				opts,
			)
			const fallbackSlotKey = computeLlmCacheKey(
				'extract',
				primaryModel,
				'object',
				opts,
			)

			// THEN both slots land on the same key, so an answer the fallback
			// produced is reused once the primary is back and neither re-hits a
			// provider
			expect(fallbackSlotKey).toBe(primarySlotKey)

			// AND keying on the answering model instead would fragment the cache
			// per vendor — the failure this keying avoids
			expect(
				computeLlmCacheKey('extract', answeringModel, 'object', opts),
			).not.toBe(primarySlotKey)
		})
	})
})

describe('stableStringifyForCache', () => {
	it('should sort object keys so permuted options serialize identically', () => {
		// GIVEN two objects with the same entries in different orders
		const a = stableStringifyForCache({ b: 2, a: 1 })
		const b = stableStringifyForCache({ a: 1, b: 2 })

		// THEN the serializations match
		expect(a).toBe(b)
		expect(a).toBe('{"a":1,"b":2}')
	})

	it('should tolerate circular references without throwing', () => {
		// GIVEN an object that references itself
		const cyclic: Record<string, unknown> = { a: 1 }
		cyclic['self'] = cyclic

		// WHEN serialized via the cache helper
		const serialized = stableStringifyForCache(cyclic)

		// THEN it emits a sentinel instead of crashing
		expect(serialized).toContain('[circular]')
	})

	it('should drop function values so closures do not bleed into the key', () => {
		// GIVEN an options object that carries a function (e.g. onChunk callback)
		const input = { prompt: 'x', onChunk: () => undefined }

		// WHEN serialized
		const serialized = stableStringifyForCache(input)

		// THEN the function is omitted — two calls with different closures hash the same
		expect(serialized).toBe('{"prompt":"x"}')
	})
})

describe('rehydrateCachedResponse', () => {
	// text, toolCalls, toolResults, and usage are all getters derived from
	// `content`; the cache stores only `content` as JSON, so a Pg hit returns a
	// bare object where those getters read undefined — the reflect loop then
	// crashes iterating `response.toolResults`.
	const content = [
		{ type: 'text', text: 'Acme is a logistics company.' },
		{
			type: 'tool-call',
			id: 'call_1',
			name: 'scrape_page',
			params: { url: 'https://acme.example' },
		},
		{
			type: 'tool-result',
			id: 'call_1',
			name: 'scrape_page',
			result: { url: 'https://acme.example', markdown: '# Acme' },
			encodedResult: undefined,
		},
		{
			type: 'finish',
			reason: 'stop',
			usage: {
				inputTokens: {
					uncached: undefined,
					total: 12,
					cacheRead: undefined,
					cacheWrite: undefined,
				},
				outputTokens: { total: 7, text: undefined, reasoning: undefined },
			},
		},
	] as ConstructorParameters<typeof LanguageModel.GenerateTextResponse>[0]

	describe('when a text response is replayed from the JSON cache', () => {
		it('should restore the getters a fresh generation would expose', () => {
			// GIVEN a real text response serialized to the cache and read back (Pg hit)
			const original = new LanguageModel.GenerateTextResponse(content)
			const stored = JSON.parse(JSON.stringify(original)) as unknown

			// THEN the bare JSON has lost its getters — the exact crash the loop hit
			expect((stored as { toolResults?: unknown }).toolResults).toBeUndefined()

			// WHEN it is rehydrated
			const replayed = rehydrateCachedResponse(
				'text',
				stored,
			) as typeof original

			// THEN every getter behaves exactly like the fresh response
			expect(replayed.toolResults.length).toBe(1)
			expect((replayed.toolResults[0] as { name: string }).name).toBe(
				'scrape_page',
			)
			expect(replayed.text).toBe(original.text)
			expect(replayed.toolCalls.length).toBe(1)
			expect(replayed.usage.inputTokens.total).toBe(12)
		})
	})

	describe('when an object response is replayed', () => {
		it('should restore the parsed value alongside the getters', () => {
			// GIVEN a structured (object) response round-tripped through the cache
			const original = new LanguageModel.GenerateObjectResponse(
				{ company: 'Acme' },
				content,
			)
			const stored = JSON.parse(JSON.stringify(original)) as unknown

			// WHEN it is rehydrated as an object result
			const replayed = rehydrateCachedResponse(
				'object',
				stored,
			) as typeof original

			// THEN both the parsed value and the derived getters come back
			expect(replayed.value).toEqual({ company: 'Acme' })
			expect(replayed.toolResults.length).toBe(1)
			expect(replayed.text).toBe(original.text)
		})
	})
})

// ── DB-backed behaviors ──
// Real Postgres + in-process Cache interactions. Require `pnpm cli services up`
// and the 0001 migration applied. Scaffolded so BDD intent is discoverable.
describe('llm cache layers (integration)', () => {
	it.todo(
		'should serve the in-process mem layer before touching Pg on repeat hits',
	)
	it.todo(
		'should collapse concurrent misses to a single inner call via pg_advisory_xact_lock',
	)
	it.todo(
		'should record the model that answered on the cache row while keying the row under the tier primary model',
	)
})

describe('counting what a model call consumed', () => {
	// The cache sits in front of the provider, so what a run is billed depends on
	// whether a call reached one. A fake provider makes that observable without a
	// network call; the store is stubbed to always miss, so `invoke` takes the
	// path that reaches the provider.
	// `rows` is what a lookup finds: nothing (so the call reaches the provider),
	// or a stored answer (so it is served from the cache).
	const storeHolding = (rows: ReadonlyArray<{ response: unknown }>) => {
		const query = () => Effect.succeed(rows)
		return Object.assign(query, {
			withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
		}) as unknown as SqlClient.SqlClient
	}
	const alwaysMissingStore = storeHolding([])

	const responseUsing = (inputTokens: number, outputTokens: number) =>
		new LanguageModel.GenerateTextResponse([
			{
				type: 'finish' as const,
				reason: 'stop' as const,
				usage: {
					inputTokens: { total: inputTokens },
					outputTokens: { total: outputTokens },
				},
			},
		] as never)

	const runOneCall = (options: {
		readonly reachesProvider: boolean
		readonly cacheable?: boolean
	}) => {
		const answer = responseUsing(2000, 1000)
		const store = options.reachesProvider
			? alwaysMissingStore
			: storeHolding([{ response: { content: answer.content } }])
		return Effect.gen(function* () {
			const meter = yield* makeUsageMeter
			const inner = {
				generateText: () => Effect.succeed(answer),
				generateObject: () => Effect.succeed(answer),
				streamText: () => Stream.empty,
			} as unknown as LanguageModel.Service
			const cached = yield* makeCachedLanguageModel(
				inner,
				'agent',
				'a-model',
				'a-model',
				{ inCentsPer1k: 0.01, outCentsPer1k: 0.03 },
			).pipe(Effect.provideService(SqlClient.SqlClient, store))
			yield* (
				cached.generateText({
					prompt: 'hello',
					...(options.cacheable === false ? { cacheable: false } : {}),
				} as never) as Effect.Effect<unknown, never, never>
			).pipe(Effect.provideService(UsageMeter, meter))
			return yield* meter.snapshot()
		}).pipe(Effect.provideService(SqlClient.SqlClient, store))
	}

	describe('when the call reached the provider', () => {
		it('should count its tokens and charge the slot rate', async () => {
			// GIVEN a slot charging 0.01c per thousand read and 0.03c per thousand
			// written, and a call that read 2000 and wrote 1000
			// WHEN the call runs
			const snapshot = await Effect.runPromise(
				runOneCall({ reachesProvider: true }),
			)

			// THEN the tokens are counted and billed: 0.02c + 0.03c
			expect(snapshot.tokensIn).toBe(2000)
			expect(snapshot.tokensOut).toBe(1000)
			expect(snapshot.costByBucket['llm_agent']).toBeCloseTo(0.05, 6)
		})
	})

	describe('when the call is one that is never stored', () => {
		it('should still count what it consumed', async () => {
			// GIVEN a call marked as not worth storing — it still reaches the
			// provider and the provider still bills for it
			// WHEN it runs
			const snapshot = await Effect.runPromise(
				runOneCall({ reachesProvider: true, cacheable: false }),
			)

			// THEN it is counted like any other call that reached the provider;
			// skipping it would leave real spending out of the run's total
			expect(snapshot.tokensIn).toBe(2000)
			expect(snapshot.tokensOut).toBe(1000)
			expect(snapshot.costByBucket['llm_agent']).toBeCloseTo(0.05, 6)
		})
	})

	describe('when the answer came from the cache', () => {
		it('should count nothing', async () => {
			// GIVEN a stored answer for the same call, so the provider is never reached
			// WHEN it runs
			const snapshot = await Effect.runPromise(
				runOneCall({ reachesProvider: false }),
			)

			// THEN nothing is counted — a reused answer bills no one, so counting it
			// would inflate every run that hits the cache
			expect(snapshot.tokensIn).toBe(0)
			expect(snapshot.costCents).toBe(0)
			expect(snapshot.costByBucket).toEqual({})
		})
	})
})
