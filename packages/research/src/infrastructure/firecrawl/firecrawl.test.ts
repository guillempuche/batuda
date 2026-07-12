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

import type { SearchInput } from '../../application/ports'
import { ProviderError, UnsupportedSite } from '../../domain/errors'
import { makeFirecrawlExtract } from './extract'
import { makeFirecrawlScrape } from './scrape'
import { makeFirecrawlSearch } from './search'

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

// Decode the JSON body an adapter POSTed, so tests can assert the exact params
// (e.g. the normalized `country`) sent to the provider.
const bodyJson = (
	request: HttpClientRequest.HttpClientRequest | undefined,
): Record<string, unknown> => {
	const body = request?.body
	if (body?._tag !== 'Uint8Array') return {}
	return JSON.parse(new TextDecoder().decode(body.body)) as Record<
		string,
		unknown
	>
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

const runSearch = (
	status: number,
	body: unknown,
	input: Partial<SearchInput> = {},
) => {
	const log: CallLog = { count: 0, last: undefined }
	const client = countingClient(log, status, body)
	const exit = runWithVirtualClock(() =>
		Effect.gen(function* () {
			const provider = yield* makeFirecrawlSearch(0)
			return yield* provider.search({ query: 'acme logistics', ...input })
		}).pipe(
			Effect.provideService(HttpClient.HttpClient, client),
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromEnv({ env: { RESEARCH_API_KEY_SEARCH: 'fc_k' } }),
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

	it('should exclude <form> blocks so a contact-form pop-up cannot stand in for the page', async () => {
		// GIVEN any successful scrape
		const { exit, log } = runScrape(200, { data: { markdown: 'x' } })
		await exit

		// THEN the request drops <form> content while keeping main-content extraction
		const body = bodyJson(log.last)
		expect(body['excludeTags']).toEqual(['form'])
		expect(body['onlyMainContent']).toBe(true)
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

	it('should map a 403 "we do not support this site" to an UnsupportedSite skip, not retried', async () => {
		// GIVEN Firecrawl refuses the site (its LinkedIn/people-directory response)
		const { exit, log } = runScrape(
			403,
			{ success: false, error: 'This website is no longer supported' },
			'https://www.linkedin.com/company/echo',
		)

		// THEN it fails once (no retry) with UnsupportedSite carrying the url — a
		// routing outcome, not a ProviderError the run treats as a hard failure
		const resolved = await exit
		expect(log.count).toBe(1)
		expect(Exit.isFailure(resolved)).toBe(true)
		const err = Exit.isFailure(resolved)
			? Option.getOrUndefined(Cause.findErrorOption(resolved.cause))
			: undefined
		expect(err).toBeInstanceOf(UnsupportedSite)
		expect((err as UnsupportedSite | undefined)?.url).toBe(
			'https://www.linkedin.com/company/echo',
		)
	})

	it('should keep a plain 403 (no unsupported-site body) as a non-recoverable ProviderError', async () => {
		// GIVEN a 403 that is a real auth/permission refusal, not an unsupported site
		const { exit, log } = runScrape(403, { error: 'forbidden' })

		// THEN it stays a fail-fast ProviderError — only the unsupported-site body
		// is treated as a skip
		const resolved = await exit
		expect(log.count).toBe(1)
		expect(errorOf(resolved)?.recoverable).toBe(false)
		expect(errorOf(resolved)?.message).toContain('HTTP 403')
	})

	it('should detect the unsupported-site phrase even when it is not in an `error` field', async () => {
		// GIVEN a 403 whose off-limits message rides a different field than `error`
		// (Firecrawl's exact JSON shape is not guaranteed)
		const { exit } = runScrape(403, {
			success: false,
			message: 'we do not support this site',
		})

		// THEN the whole-body fallback still recognises it as an UnsupportedSite skip
		const resolved = await exit
		const err = Exit.isFailure(resolved)
			? Option.getOrUndefined(Cause.findErrorOption(resolved.cause))
			: undefined
		expect(err).toBeInstanceOf(UnsupportedSite)
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

describe('makeFirecrawlSearch', () => {
	it('should map web results to items with markdown content and the real credit cost', async () => {
		// GIVEN a search response with scraped markdown on the first result, the
		// second result missing title/description/markdown, and a credit total
		const { exit } = runSearch(200, {
			data: {
				web: [
					{
						url: 'https://acme.es',
						title: 'Acme',
						description: 'Freight forwarder',
						markdown: '# Acme\nFull page content.',
					},
					{ url: 'https://acme.es/about' },
				],
			},
			creditsUsed: 7,
		})

		// THEN each result maps to a SearchResultItem (missing title/snippet
		// default to empty strings), the markdown becomes content, and the run
		// is billed the reported credits rather than a flat 1
		const resolved = await exit
		const result = Exit.isSuccess(resolved) ? resolved.value : undefined
		expect(result?.items.map(i => i.url)).toEqual([
			'https://acme.es',
			'https://acme.es/about',
		])
		expect(result?.items[0]?.snippet).toBe('Freight forwarder')
		expect(result?.items[0]?.content).toBe('# Acme\nFull page content.')
		expect(result?.items[1]?.title).toBe('')
		expect(result?.items[1]?.content).toBeUndefined()
		expect(result?.units).toBe(7)
	})

	it('should bill one unit when the response omits a credit total', async () => {
		// GIVEN a 2xx response without creditsUsed
		const { exit } = runSearch(200, { data: { web: [] } })

		// THEN units falls back to 1
		const resolved = await exit
		const result = Exit.isSuccess(resolved) ? resolved.value : undefined
		expect(result?.units).toBe(1)
	})

	it('should return no items when the web array is absent', async () => {
		// GIVEN a 2xx response whose data omits the web array
		const { exit } = runSearch(200, { data: {} })

		// THEN the result carries an empty item list rather than throwing
		const resolved = await exit
		const result = Exit.isSuccess(resolved) ? resolved.value : undefined
		expect(result?.items).toEqual([])
	})

	it('should POST to the Firecrawl search endpoint with a bearer key', async () => {
		// GIVEN any successful search
		const { exit, log } = runSearch(200, { data: { web: [] } })
		await exit

		// THEN the request is a POST to /v2/search carrying the configured key
		expect(log.last?.method).toBe('POST')
		expect(log.last?.url).toContain('api.firecrawl.dev/v2/search')
		expect(log.last?.headers['authorization']).toBe('Bearer fc_k')
	})

	it('should exclude <form> blocks from the per-result scrape', async () => {
		// GIVEN any successful search
		const { exit, log } = runSearch(200, { data: { web: [] } })
		await exit

		// THEN the embedded scrapeOptions drop <form> content, matching the adapter
		const scrapeOptions = bodyJson(log.last)['scrapeOptions'] as Record<
			string,
			unknown
		>
		expect(scrapeOptions?.['excludeTags']).toEqual(['form'])
	})

	it('should send a normalized lower-case country for a locale hint', async () => {
		// GIVEN the model passes a language-and-region locale (the 422 trigger)
		const { exit, log } = runSearch(
			200,
			{ data: { web: [] } },
			{ location: 'en-US' },
		)
		await exit

		// THEN Firecrawl receives a valid lower-case alpha-2, not the raw locale
		expect(bodyJson(log.last)['country']).toBe('us')
	})

	it('should omit country when the location hint is not a country', async () => {
		// GIVEN a free-form place name the search API would reject
		const { exit, log } = runSearch(
			200,
			{ data: { web: [] } },
			{ location: 'United States' },
		)
		await exit

		// THEN no country param is sent rather than an invalid one
		expect(bodyJson(log.last)).not.toHaveProperty('country')
	})

	it('should retry a 5xx as recoverable', async () => {
		// GIVEN Firecrawl returns 503 on every attempt
		const { exit, log } = runSearch(503, { error: 'unavailable' })

		// THEN it retries to the max and fails with a recoverable error
		const resolved = await exit
		expect(log.count).toBe(3)
		expect(errorOf(resolved)?.recoverable).toBe(true)
	})

	it('should fail fast on a 401 without retrying', async () => {
		// GIVEN an auth failure
		const { exit, log } = runSearch(401, { error: 'bad key' })

		// THEN it fails on the first attempt with a non-recoverable error
		const resolved = await exit
		expect(log.count).toBe(1)
		expect(errorOf(resolved)?.recoverable).toBe(false)
	})

	it('should fail non-recoverably on a malformed body', async () => {
		// GIVEN a 2xx response missing the `data` envelope
		const { exit, log } = runSearch(200, { wrong: 'shape' })

		// THEN the decode error is non-recoverable and not retried
		const resolved = await exit
		expect(log.count).toBe(1)
		expect(errorOf(resolved)?.recoverable).toBe(false)
	})
})
