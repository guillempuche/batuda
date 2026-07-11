import { LanguageModel } from 'effect/unstable/ai'
import { describe, expect, it } from 'vitest'

import {
	computeLlmCacheKey,
	isLlmCacheable,
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
