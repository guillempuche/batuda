/**
 * Adds a DB-backed completion cache around a tier `LanguageModel.Service`.
 *
 * Key = sha256(tier + model + method + stable(options)). The entire response
 * body (text + tool_calls + usage) is cached as JSON so a cache hit can
 * replay the exact object the non-cached path would have produced, tool
 * calls included — critical for the phase-1 agent loop under retry.
 *
 * `streamText` is passed through unwrapped. Streams already force the LLM
 * provider to do incremental work and are short-lived; buffering and
 * replaying tokens from `llm_cache` is a future optimization.
 *
 * Write-through on success, never written on failure (we don't want to
 * cache a TimeoutException). Deterministic-only: callers that pass
 * `temperature > 0` on `options` bypass the cache entirely. Opt-out per call
 * via `options.cacheable === false` (used by prompts that embed `Date.now()`
 * or user PII).
 */

import { createHash } from 'node:crypto'

import { Cache, Duration, Effect, Option } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

export type LlmTier = 'agent' | 'extract' | 'writer'

const sha256Hex = (input: string): string =>
	createHash('sha256').update(input).digest('hex')

export const stableStringifyForCache = (value: unknown): string => {
	const seen = new WeakSet()
	const walk = (v: unknown): unknown => {
		if (v === null || typeof v !== 'object') return v
		if (seen.has(v as object)) return '[circular]'
		seen.add(v as object)
		if (Array.isArray(v)) return v.map(walk)
		const entries = Object.entries(v as Record<string, unknown>)
			.filter(([, val]) => typeof val !== 'function')
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([k, val]) => [k, walk(val)] as const)
		return Object.fromEntries(entries)
	}
	return JSON.stringify(walk(value))
}

export const computeLlmCacheKey = (
	tier: LlmTier,
	model: string,
	method: 'text' | 'object',
	options: unknown,
): string =>
	sha256Hex(`${tier}|${model}|${method}|${stableStringifyForCache(options)}`)

export const isLlmCacheable = (options: unknown): boolean => {
	if (!options || typeof options !== 'object') return true
	const o = options as Record<string, unknown>
	if (o['cacheable'] === false) return false
	const temperature = o['temperature']
	if (typeof temperature === 'number' && temperature > 0) return false
	return true
}

const promptPreview = (options: unknown): string => {
	if (!options || typeof options !== 'object') return ''
	const prompt = (options as { prompt?: unknown }).prompt
	if (typeof prompt === 'string') return prompt.slice(0, 200)
	return stableStringifyForCache(prompt).slice(0, 200)
}

const tokensFromResponse = (response: unknown) => {
	const usage = (response as { usage?: unknown }).usage as
		| {
				inputTokens?: { total?: number }
				outputTokens?: { total?: number }
		  }
		| undefined
	return {
		tokensIn: usage?.inputTokens?.total ?? 0,
		tokensOut: usage?.outputTokens?.total ?? 0,
	}
}

const TTL_DAYS = 30

/**
 * In-process front-line cache in front of `llm_cache`.
 *
 * - Capacity 500 LRU entries per tier instance (bounded memory)
 * - 5-minute TTL so a long-running fiber eventually re-reads Pg (in case
 *   another process invalidated via `schema_version` bump or similar)
 * - No single-flight: two concurrent misses for the same key will both
 *   issue a Pg read and potentially both reach the provider. Pg UPSERT on
 *   the write path keeps this safe; collapsing stampedes is the job of the
 *   outer advisory-lock layer when needed.
 */
const MEM_CACHE_CAPACITY = 500
const MEM_CACHE_TTL = Duration.minutes(5)

/**
 * Build a cached facade around `inner`. Requires `SqlClient` in the
 * environment; the returned service exposes the same shape as the input
 * and is suitable for `Layer.succeed(Tag)(cached)` composition in the
 * tier-layer builder.
 */
export const makeCachedLanguageModel = (
	inner: LanguageModel.Service,
	tier: LlmTier,
	model: string,
): Effect.Effect<LanguageModel.Service, never, SqlClient.SqlClient> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const memCache = yield* Cache.make<string, unknown, never, never>({
			capacity: MEM_CACHE_CAPACITY,
			timeToLive: MEM_CACHE_TTL,
			lookup: () =>
				Effect.die('llm memCache lookup invoked — expected set-only'),
		})

		const lookup = (keyHash: string) =>
			sql<{ response: unknown }>`
				SELECT response
				FROM llm_cache
				WHERE key_hash = ${keyHash}
					AND expires_at > now()
				LIMIT 1
			`.pipe(Effect.catchCause(() => Effect.succeed([])))

		const writeRow = (keyHash: string, options: unknown, response: unknown) => {
			const { tokensIn, tokensOut } = tokensFromResponse(response)
			return sql`
				INSERT INTO llm_cache (
					key_hash, tier, model, prompt_preview, response,
					tokens_in, tokens_out,
					cached_at, expires_at
				) VALUES (
					${keyHash}, ${tier}, ${model},
					${promptPreview(options)},
					${JSON.stringify(response)}::jsonb,
					${tokensIn}, ${tokensOut},
					now(), now() + (${`${TTL_DAYS} days`})::interval
				)
				ON CONFLICT (key_hash) DO UPDATE SET
					response    = EXCLUDED.response,
					tokens_in   = EXCLUDED.tokens_in,
					tokens_out  = EXCLUDED.tokens_out,
					cached_at   = EXCLUDED.cached_at,
					expires_at  = EXCLUDED.expires_at
			`.pipe(Effect.ignore)
		}

		const bumpHitCount = (keyHash: string) =>
			sql`
				UPDATE llm_cache
				SET hit_count = hit_count + 1
				WHERE key_hash = ${keyHash}
			`.pipe(Effect.ignore)

		const invoke = <A>(
			method: 'text' | 'object',
			options: unknown,
			call: Effect.Effect<A, unknown, unknown>,
		): Effect.Effect<A, unknown, unknown> => {
			if (!isLlmCacheable(options)) return call

			const keyHash = computeLlmCacheKey(tier, model, method, options)
			const baseAttrs = {
				port: 'llm',
				cache_table: 'llm_cache',
				tier,
				model,
				method,
				key_hash: keyHash,
				event: 'cache.hit',
			}
			return Effect.gen(function* () {
				const cached = yield* Cache.getOption(memCache, keyHash)
				if (Option.isSome(cached)) {
					yield* Effect.logDebug('cache.hit').pipe(
						Effect.annotateLogs({ ...baseAttrs, layer: 'mem' }),
					)
					return cached.value as A
				}

				const hits = yield* lookup(keyHash)
				const hit = hits[0]
				if (hit) {
					yield* bumpHitCount(keyHash)
					yield* Cache.set(memCache, keyHash, hit.response)
					yield* Effect.logDebug('cache.hit').pipe(
						Effect.annotateLogs({ ...baseAttrs, layer: 'pg' }),
					)
					return hit.response as A
				}

				const response = yield* call
				yield* writeRow(keyHash, options, response)
				yield* Cache.set(memCache, keyHash, response)
				return response
			})
		}

		const generateText = (options: unknown) =>
			invoke(
				'text',
				options,
				inner.generateText(options as never) as unknown as Effect.Effect<
					unknown,
					unknown,
					unknown
				>,
			)

		const generateObject = (options: unknown) =>
			invoke(
				'object',
				options,
				inner.generateObject(options as never) as unknown as Effect.Effect<
					unknown,
					unknown,
					unknown
				>,
			)

		return {
			generateText,
			generateObject,
			streamText: inner.streamText,
		} as unknown as LanguageModel.Service
	})
