import { Cause, ConfigProvider, Effect, Exit, Fiber, Option } from 'effect'
import { TestClock } from 'effect/testing'
import {
	HttpClient,
	type HttpClientError,
	type HttpClientRequest,
	type HttpClientResponse,
	HttpClientResponse as HttpClientResponseNs,
} from 'effect/unstable/http'
import { describe, expect, it } from 'vitest'

import { ProviderError } from '../../domain/errors'
import { makeBraveLlmContextSearch } from './llm-context'

const jsonResponse = (
	request: HttpClientRequest.HttpClientRequest,
	status: number,
	body: unknown,
): HttpClientResponse.HttpClientResponse =>
	HttpClientResponseNs.fromWeb(
		request,
		new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' },
		}),
	)

interface CallLog {
	count: number
	last: HttpClientRequest.HttpClientRequest | undefined
}

const countingClient = (
	log: CallLog,
	status: number,
	body: unknown,
): HttpClient.HttpClient =>
	HttpClient.makeWith<
		HttpClientError.HttpClientError,
		never,
		HttpClientError.HttpClientError,
		never
	>(
		effect =>
			Effect.flatMap(effect, request => {
				log.count += 1
				log.last = request
				return Effect.succeed(jsonResponse(request, status, body))
			}),
		Effect.succeed,
	)

const runWithVirtualClock = async <A, E>(
	build: () => Effect.Effect<A, E, never>,
	budgetMs = 60_000,
	stepMs = 100,
): Promise<Exit.Exit<A, E>> => {
	const program = Effect.gen(function* () {
		const fiber = yield* Effect.forkChild(build())
		for (let elapsed = 0; elapsed < budgetMs; elapsed += stepMs) {
			if (fiber.pollUnsafe() !== undefined) break
			yield* Effect.yieldNow
			yield* TestClock.adjust(`${stepMs} millis`)
		}
		return yield* Fiber.await(fiber)
	})
	return Effect.runPromise(
		Effect.scoped(program).pipe(Effect.provide(TestClock.layer())),
	)
}

const errorOf = (
	exit: Exit.Exit<unknown, unknown>,
): ProviderError | undefined => {
	if (!Exit.isFailure(exit)) return undefined
	const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
	return err instanceof ProviderError ? err : undefined
}

interface SearchArgs {
	readonly query: string
	readonly recency?: { days: number }
	readonly languages?: string[]
	readonly location?: string
}

const runSearch = (
	status: number,
	body: unknown,
	args: SearchArgs = { query: 'acme logistics' },
) => {
	const log: CallLog = { count: 0, last: undefined }
	const client = countingClient(log, status, body)
	const exit = runWithVirtualClock(() =>
		Effect.gen(function* () {
			const provider = yield* makeBraveLlmContextSearch(0)
			return yield* provider.search(args)
		}).pipe(
			Effect.provideService(HttpClient.HttpClient, client),
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromEnv({
						env: { RESEARCH_API_KEY_SEARCH: 'brv_k' },
					}),
				),
			),
		),
	)
	return { exit, log }
}

describe('makeBraveLlmContextSearch', () => {
	describe('when the endpoint returns grounding passages', () => {
		it('should map each source to an item whose content is its joined snippets', async () => {
			// GIVEN two grounded sources, the second with no usable snippets
			const { exit } = runSearch(200, {
				grounding: {
					generic: [
						{
							url: 'https://acme.com/about',
							title: 'About Acme',
							snippets: ['Acme was founded in 2011.', 'HQ in Chicago, IL.'],
						},
						{ url: 'https://empty.com', title: 'Empty', snippets: ['  '] },
					],
				},
			})

			// THEN the first becomes a content-bearing item; the empty one is dropped
			const resolved = await exit
			const result = Exit.isSuccess(resolved) ? resolved.value : undefined
			expect(result?.items.map(i => i.url)).toEqual(['https://acme.com/about'])
			expect(result?.items[0]?.content).toBe(
				'Acme was founded in 2011.\n\nHQ in Chicago, IL.',
			)
			expect(result?.units).toBe(1)
		})
	})

	describe('when passed recency and language hints', () => {
		it('should send the context token budgets, a freshness bucket, and the language', async () => {
			// GIVEN a 3-day recency window and a Spanish language hint
			const { exit, log } = runSearch(
				200,
				{ grounding: { generic: [] } },
				{ query: 'acme', recency: { days: 3 }, languages: ['es'] },
			)
			await exit

			// THEN the request carries the token budgets, the past-week bucket, and lang
			const params = [...(log.last?.urlParams ?? [])]
			const has = (k: string, v: string) =>
				params.some(([pk, pv]) => pk === k && pv === v)
			expect(has('maximum_number_of_tokens', '8192')).toBe(true)
			expect(has('maximum_number_of_tokens_per_url', '4096')).toBe(true)
			expect(has('freshness', 'pw')).toBe(true)
			expect(has('search_lang', 'es')).toBe(true)
		})
	})

	describe('when the endpoint fails', () => {
		it('should surface a 401 as a ProviderError, not a clean empty result', async () => {
			// GIVEN a rejected request (bad key)
			const { exit } = runSearch(401, { detail: 'unauthorized' })

			// THEN it fails loudly so the fallback and retry harness see it
			const err = errorOf(await exit)
			expect(err?.provider).toBe('brave-context')
			expect(err?.recoverable).toBe(false)
		})
	})

	describe('when the response has no grounding', () => {
		it('should return an empty result without error', async () => {
			// GIVEN a 200 with an absent grounding block
			const { exit } = runSearch(200, {})

			// THEN it is a clean empty success (an honest zero-hit)
			const resolved = await exit
			const result = Exit.isSuccess(resolved) ? resolved.value : undefined
			expect(result?.items).toEqual([])
		})
	})
})
