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
import { makeBraveSearch } from './search'

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
			const provider = yield* makeBraveSearch(0)
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

describe('makeBraveSearch', () => {
	it('should map results to items and fold extra_snippets into content', async () => {
		// GIVEN two results, the first carrying extra snippets, the second none
		const { exit } = runSearch(200, {
			web: {
				results: [
					{
						url: 'https://acme.es',
						title: 'Acme',
						description: 'Freight forwarder',
						extra_snippets: ['Founded 1998', 'Barcelona HQ'],
					},
					{
						url: 'https://acme.es/about',
						title: 'About',
						description: 'About us',
					},
				],
			},
		})

		// THEN the extra snippets join into content; a result without them has none
		const resolved = await exit
		const result = Exit.isSuccess(resolved) ? resolved.value : undefined
		expect(result?.items.map(i => i.url)).toEqual([
			'https://acme.es',
			'https://acme.es/about',
		])
		expect(result?.items[0]?.content).toBe('Founded 1998\nBarcelona HQ')
		expect(result?.items[1]?.content).toBeUndefined()
		expect(result?.units).toBe(1)
	})

	it('should request extra_snippets and map recency to a freshness bucket', async () => {
		// GIVEN a search with a 3-day recency window
		const { exit, log } = runSearch(
			200,
			{ web: { results: [] } },
			{ query: 'acme', recency: { days: 3 }, languages: ['es'] },
		)
		await exit

		// THEN the request asks for extra snippets, the past-week bucket (not an
		// invalid pd3), and the search language
		const params = [...(log.last?.urlParams ?? [])]
		const has = (k: string, v: string) =>
			params.some(([pk, pv]) => pk === k && pv === v)
		expect(has('extra_snippets', 'true')).toBe(true)
		expect(has('freshness', 'pw')).toBe(true)
		expect(has('search_lang', 'es')).toBe(true)
	})

	it('should send a normalized upper-case country for a locale hint', async () => {
		// GIVEN the model passes a language-and-region locale as the location
		const { exit, log } = runSearch(
			200,
			{ web: { results: [] } },
			{ query: 'acme', location: 'en-US' },
		)
		await exit

		// THEN Brave receives a valid upper-case alpha-2, not the raw locale
		const params = [...(log.last?.urlParams ?? [])]
		expect(params.some(([k, v]) => k === 'country' && v === 'US')).toBe(true)
	})

	it('should omit country when the location hint is not a country', async () => {
		// GIVEN a free-form place name Brave would reject
		const { exit, log } = runSearch(
			200,
			{ web: { results: [] } },
			{ query: 'acme', location: 'United States' },
		)
		await exit

		// THEN no country param is sent rather than an invalid one
		const params = [...(log.last?.urlParams ?? [])]
		expect(params.some(([k]) => k === 'country')).toBe(false)
	})

	it('should surface an HTTP error instead of masking it as an empty result', async () => {
		// GIVEN a 401 (bad subscription token) with a JSON error body — the shape
		// that previously decoded to a "successful" empty result
		const { exit, log } = runSearch(401, {
			type: 'ErrorResponse',
			error: { code: 'SUBSCRIPTION_TOKEN_INVALID' },
		})

		// THEN it fails with a non-recoverable ProviderError on the first attempt,
		// so retry and cross-vendor fallback can act on it
		const resolved = await exit
		expect(log.count).toBe(1)
		expect(errorOf(resolved)?.recoverable).toBe(false)
	})

	it('should treat 429 as recoverable and retry', async () => {
		// GIVEN a rate-limit response on every attempt
		const { exit, log } = runSearch(429, { error: 'rate limited' })

		// THEN it retries to the max and surfaces a recoverable error
		const resolved = await exit
		expect(log.count).toBe(3)
		expect(errorOf(resolved)?.recoverable).toBe(true)
	})

	it('should treat a 503 as recoverable', async () => {
		// GIVEN Brave returns 503 on every attempt
		const { exit, log } = runSearch(503, { error: 'unavailable' })

		// THEN it retries to the max with a recoverable error
		const resolved = await exit
		expect(log.count).toBe(3)
		expect(errorOf(resolved)?.recoverable).toBe(true)
	})

	it('should return an empty result for a genuine zero-hit (web absent)', async () => {
		// GIVEN a 200 whose body has no web section (no matches)
		const { exit, log } = runSearch(200, {})

		// THEN it succeeds with no items and does not retry — an empty search is
		// not an error
		const resolved = await exit
		const result = Exit.isSuccess(resolved) ? resolved.value : undefined
		expect(result?.items).toEqual([])
		expect(log.count).toBe(1)
	})
})
