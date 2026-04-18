import { describe, expect, it } from 'vitest'

import {
	computeLlmCacheKey,
	isLlmCacheable,
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
})
