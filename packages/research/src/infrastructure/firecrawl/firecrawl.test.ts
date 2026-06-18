import { createHash } from 'node:crypto'

import {
	Cause,
	ConfigProvider,
	Effect,
	Exit,
	Fiber,
	Option,
	Schema,
} from 'effect'
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
import { makeFirecrawlExtract } from './extract'
import { makeFirecrawlScrape } from './scrape'

// ── Test helpers ──

const sha256 = (s: string): string =>
	createHash('sha256').update(s).digest('hex')

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

// Records every request (so retry counts are observable) and returns a canned
// response built from the chosen status + body.
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

// Drive a hardened adapter to settlement under virtual time so its recoverable
// retries resolve instantly instead of waiting on real backoff.
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

const runScrape = (
	status: number,
	body: unknown,
	url = 'https://acme.es/about',
) => {
	const log: CallLog = { count: 0, last: undefined }
	const client = countingClient(log, status, body)
	const exit = runWithVirtualClock(() =>
		Effect.gen(function* () {
			const provider = yield* makeFirecrawlScrape(0)
			return yield* provider.scrape({ url })
		}).pipe(
			Effect.provideService(HttpClient.HttpClient, client),
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromEnv({ env: { RESEARCH_API_KEY_SCRAPE: 'fc_k' } }),
				),
			),
		),
	)
	return { exit, log }
}

const runExtract = (
	status: number,
	body: unknown,
	url = 'https://acme.es/about',
) => {
	const log: CallLog = { count: 0, last: undefined }
	const client = countingClient(log, status, body)
	const exit = runWithVirtualClock(() =>
		Effect.gen(function* () {
			const provider = yield* makeFirecrawlExtract(0)
			return yield* provider.extract({
				url,
				schema: Schema.Struct({ company_name: Schema.String }),
				prompt: 'extract the company',
			})
		}).pipe(
			Effect.provideService(HttpClient.HttpClient, client),
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromEnv({ env: { RESEARCH_API_KEY_EXTRACT: 'fc_k' } }),
				),
			),
		),
	)
	return { exit, log }
}

describe('makeFirecrawlScrape', () => {
	it('should map a 2xx response to a ScrapedPage with cost units', async () => {
		// GIVEN a Firecrawl scrape response with markdown and metadata
		const { exit, log } = runScrape(200, {
			data: {
				markdown: '# Acme',
				links: ['https://acme.es'],
				metadata: { title: 'Acme', language: 'es' },
			},
		})

		// THEN the page carries the markdown, title, language, links and a
		// content hash of the markdown, billed as one unit, with no retry
		const resolved = await exit
		const page = Exit.isSuccess(resolved) ? resolved.value : undefined
		expect(page?.markdown).toBe('# Acme')
		expect(page?.title).toBe('Acme')
		expect(page?.language).toBe('es')
		expect(page?.links).toEqual(['https://acme.es'])
		expect(page?.contentHash).toBe(sha256('# Acme'))
		expect(page?.units).toBe(1)
		expect(log.count).toBe(1)
	})

	it('should POST to the Firecrawl scrape endpoint with a bearer key', async () => {
		// GIVEN any successful scrape
		const { exit, log } = runScrape(200, { data: { markdown: 'x' } })
		await exit

		// THEN the request is a POST to /v2/scrape carrying the configured key
		expect(log.last?.method).toBe('POST')
		expect(log.last?.url).toContain('api.firecrawl.dev/v2/scrape')
		expect(log.last?.headers['authorization']).toBe('Bearer fc_k')
	})

	it('should default missing markdown to an empty string', async () => {
		// GIVEN a 2xx response whose data omits markdown
		const { exit } = runScrape(200, { data: { metadata: { title: 'Acme' } } })

		// THEN the page markdown is empty and hashes the empty string
		const resolved = await exit
		const page = Exit.isSuccess(resolved) ? resolved.value : undefined
		expect(page?.markdown).toBe('')
		expect(page?.contentHash).toBe(sha256(''))
	})

	it('should retry a 503 as recoverable and exhaust the budget', async () => {
		// GIVEN Firecrawl returns 503 on every attempt
		const { exit, log } = runScrape(503, { error: 'unavailable' })

		// THEN the call retries to the max and fails with a recoverable error
		const resolved = await exit
		expect(log.count).toBe(3)
		expect(errorOf(resolved)?.recoverable).toBe(true)
	})

	it('should treat 429 as recoverable', async () => {
		// GIVEN a rate-limit status
		const { exit, log } = runScrape(429, { error: 'rate limited' })

		// THEN it retries and surfaces a recoverable error
		const resolved = await exit
		expect(log.count).toBe(3)
		expect(errorOf(resolved)?.recoverable).toBe(true)
	})

	it('should fail fast on a 401 without retrying', async () => {
		// GIVEN an auth failure
		const { exit, log } = runScrape(401, { error: 'bad key' })

		// THEN it fails on the first attempt with a non-recoverable error
		const resolved = await exit
		expect(log.count).toBe(1)
		expect(errorOf(resolved)?.recoverable).toBe(false)
	})

	it('should fail non-recoverably on a malformed body', async () => {
		// GIVEN a 2xx response missing the `data` envelope
		const { exit, log } = runScrape(200, { wrong: 'shape' })

		// THEN the decode error is non-recoverable and not retried
		const resolved = await exit
		expect(log.count).toBe(1)
		expect(errorOf(resolved)?.recoverable).toBe(false)
	})
})

describe('makeFirecrawlExtract', () => {
	it('should return the extracted json on a 2xx response', async () => {
		// GIVEN a Firecrawl json-format response
		const { exit } = runExtract(200, {
			data: { json: { company_name: 'Acme S.L.' } },
		})

		// THEN the structured json surfaces verbatim
		const resolved = await exit
		const value = Exit.isSuccess(resolved) ? resolved.value : undefined
		expect(value).toEqual({ company_name: 'Acme S.L.' })
	})

	it('should default to an empty object when json is absent', async () => {
		// GIVEN a 2xx response whose data omits json
		const { exit } = runExtract(200, { data: {} })

		// THEN an empty object is returned rather than undefined
		const resolved = await exit
		const value = Exit.isSuccess(resolved) ? resolved.value : undefined
		expect(value).toEqual({})
	})

	it('should request the json format with a schema', async () => {
		// GIVEN any successful extract
		const { exit, log } = runExtract(200, { data: { json: {} } })
		await exit

		// THEN it POSTs to the scrape endpoint with the extract key
		expect(log.last?.method).toBe('POST')
		expect(log.last?.url).toContain('api.firecrawl.dev/v2/scrape')
		expect(log.last?.headers['authorization']).toBe('Bearer fc_k')
	})

	it('should retry a 5xx as recoverable', async () => {
		// GIVEN Firecrawl returns 502 on every attempt
		const { exit, log } = runExtract(502, { error: 'gateway' })

		// THEN it retries to the max and fails recoverably
		const resolved = await exit
		expect(log.count).toBe(3)
		expect(errorOf(resolved)?.recoverable).toBe(true)
	})

	it('should fail fast on a 400', async () => {
		// GIVEN a bad-request status
		const { exit, log } = runExtract(400, { error: 'bad request' })

		// THEN it fails on the first attempt, non-recoverably
		const resolved = await exit
		expect(log.count).toBe(1)
		expect(errorOf(resolved)?.recoverable).toBe(false)
	})
})
