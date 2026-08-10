import { createHash } from 'node:crypto'

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

import type { SearchInput } from '../../application/ports'
import { ProviderError, UnsupportedSite } from '../../domain/errors'
import { makeFirecrawlMap } from './map'
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

const runMap = (status: number, body: unknown) => {
	const log: CallLog = { count: 0, last: undefined }
	const client = countingClient(log, status, body)
	const exit = runWithVirtualClock(() =>
		Effect.gen(function* () {
			const provider = yield* makeFirecrawlMap(0)
			return yield* provider.map({ url: 'https://acme.es', limit: 50 })
		}).pipe(
			Effect.provideService(HttpClient.HttpClient, client),
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromEnv({ env: { RESEARCH_API_KEY_MAP: 'fc_k' } }),
				),
			),
		),
	)
	return { exit, log }
}

describe('firecrawl map', () => {
	describe('when the API returns links in either shape', () => {
		it('should bill the credits the API says walking the site cost', async () => {
			// GIVEN a map response reporting the credits it consumed
			const { exit } = runMap(200, {
				creditsUsed: 4,
				links: ['https://acme.es/equipo'],
			})

			// WHEN it settles
			const settled = await exit

			// THEN that figure is what the run is charged, not a flat one — walking
			// a site costs more the more of it there is
			expect(Exit.isSuccess(settled)).toBe(true)
			if (Exit.isSuccess(settled)) expect(settled.value.units).toBe(4)
		})

		it('should normalize bare strings and {url} objects to page URLs', async () => {
			// GIVEN a map response mixing both shapes the API has used
			const { exit, log } = runMap(200, {
				links: [
					'https://acme.es/equipo',
					{ url: 'https://acme.es/sobre-nosotros' },
				],
			})

			// WHEN it settles — THEN both arrive as plain URLs
			const settled = await exit
			expect(Exit.isSuccess(settled)).toBe(true)
			if (Exit.isSuccess(settled)) {
				expect(settled.value.links).toEqual([
					'https://acme.es/equipo',
					'https://acme.es/sobre-nosotros',
				])
			}
			// AND the request carried the site and the cap
			expect(bodyJson(log.last)).toMatchObject({
				url: 'https://acme.es',
				limit: 50,
			})
		})

		it('should read a walk that returns an explicitly null link list', async () => {
			// GIVEN a map response whose links are null rather than missing
			const { exit } = runMap(200, { creditsUsed: null, links: null })

			// WHEN it settles — THEN it is a site with nothing found, not a failure,
			// and the unreported credits count as one
			const settled = await exit
			expect(Exit.isSuccess(settled)).toBe(true)
			if (Exit.isSuccess(settled)) {
				expect(settled.value.links).toEqual([])
				expect(settled.value.units).toBe(1)
			}
		})
	})

	describe('when the API rejects the request', () => {
		it('should fail fast without retrying on an auth-style 4xx', async () => {
			// GIVEN an unauthorized rejection
			const { exit, log } = runMap(401, { error: 'unauthorized' })

			// WHEN it settles — THEN one attempt, and the error is not recoverable
			const err = errorOf(await exit)
			expect(err?.recoverable).toBe(false)
			expect(log.count).toBe(1)
		})
	})
})

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
		// AND no resolvedUrl when the response reports no final URL
		expect(page?.resolvedUrl).toBeUndefined()
	})

	it('should carry the final URL from metadata.url when the fetch followed a redirect', async () => {
		// GIVEN a scrape of a domain that 301s elsewhere, so Firecrawl reports the
		// resolved address in metadata.url
		const { exit } = runScrape(200, {
			data: {
				markdown: '# Ascent',
				metadata: {
					title: 'Ascent',
					sourceURL: 'https://ascentgl.com',
					url: 'https://ascentlogistics.com/',
				},
			},
		})

		// THEN the page keeps the requested url but exposes the resolved destination
		const resolved = await exit
		const page = Exit.isSuccess(resolved) ? resolved.value : undefined
		expect(page?.url).toBe('https://acme.es/about')
		expect(page?.resolvedUrl).toBe('https://ascentlogistics.com/')
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

	it('should read a response carrying no `data` block as an empty page', async () => {
		// GIVEN a 2xx answer with no page block at all — a shape Firecrawl really
		// sends, and one whose fetch was already paid for
		const { exit, log } = runScrape(200, { success: true })

		// WHEN it settles
		const settled = await exit

		// THEN the answer stands, as a page with no content rather than a failure
		expect(Exit.isSuccess(settled)).toBe(true)
		if (Exit.isSuccess(settled)) expect(settled.value.markdown).toBe('')
		expect(log.count).toBe(1)
	})

	it('should keep a page whose metadata fields are explicitly null', async () => {
		// GIVEN a page whose metadata sends null where a string is documented
		const { exit } = runScrape(200, {
			data: {
				markdown: '# Acme',
				metadata: { title: null, language: null, url: null },
			},
		})

		// WHEN it settles
		const settled = await exit

		// THEN the page is read, with the null fields simply carrying nothing
		expect(Exit.isSuccess(settled)).toBe(true)
		if (Exit.isSuccess(settled)) {
			expect(settled.value.markdown).toBe('# Acme')
			expect(settled.value.title).toBeUndefined()
			expect(settled.value.language).toBeUndefined()
			expect(settled.value.resolvedUrl).toBeUndefined()
		}
	})

	it('should take the first entry when a page declares its language twice', async () => {
		// GIVEN a Spanish page declaring its language in both an <html lang>
		// attribute and a <meta name="language"> tag, which Firecrawl reports as a
		// list rather than as one value — ordinary markup, not an oddity
		const { exit } = runScrape(200, {
			data: {
				markdown: '# Acme',
				metadata: { language: ['es-ES', 'ES'], title: ['Acme', 'Acme SL'] },
			},
		})

		// WHEN it settles
		const settled = await exit

		// THEN the page is read and the first entry is what it carries
		expect(Exit.isSuccess(settled)).toBe(true)
		if (Exit.isSuccess(settled)) {
			expect(settled.value.language).toBe('es-ES')
			expect(settled.value.title).toBe('Acme')
		}
	})

	it('should retry when the provider reports the fetch itself did not work', async () => {
		// GIVEN a 2xx whose body says the fetch failed on Firecrawl's side
		const { exit, log } = runScrape(200, { success: false })

		// WHEN it settles — THEN that is worth another try, so it retries to the max
		const resolved = await exit
		expect(errorOf(resolved)?.recoverable).toBe(true)
		expect(log.count).toBe(3)
	})

	it('should fail non-recoverably on a body it cannot read at all', async () => {
		// GIVEN a 2xx whose `data` is not a page block
		const { exit, log } = runScrape(200, { data: 'nonsense' })

		// THEN the decode error is non-recoverable and not retried
		const resolved = await exit
		expect(log.count).toBe(1)
		expect(errorOf(resolved)?.recoverable).toBe(false)
	})
})

describe('makeFirecrawlSearch', () => {
	it('should map web results to items carrying the matching passage and the real credit cost', async () => {
		// GIVEN a search response with a matching passage on the first result, the
		// second result missing title and description, and a credit total
		const { exit } = runSearch(200, {
			data: {
				web: [
					{
						url: 'https://acme.es',
						title: 'Acme',
						description: 'Freight forwarder since 1998, 40 staff in Valencia.',
					},
					{ url: 'https://acme.es/about' },
				],
			},
			creditsUsed: 7,
		})

		// THEN the passage becomes both the snippet and the content the run can
		// cite, a result without one falls back to empty strings and no content,
		// and the run is billed the reported credits rather than a flat 1
		const resolved = await exit
		const result = Exit.isSuccess(resolved) ? resolved.value : undefined
		expect(result?.items.map(i => i.url)).toEqual([
			'https://acme.es',
			'https://acme.es/about',
		])
		expect(result?.items[0]?.snippet).toBe(
			'Freight forwarder since 1998, 40 staff in Valencia.',
		)
		expect(result?.items[0]?.content).toBe(
			'Freight forwarder since 1998, 40 staff in Valencia.',
		)
		expect(result?.items[1]?.title).toBe('')
		expect(result?.items[1]?.snippet).toBe('')
		expect(result?.items[1]?.content).toBeUndefined()
		expect(result?.units).toBe(7)
	})

	it('should keep the whole passage as content and preview it in the snippet', async () => {
		// GIVEN a passage longer than the snippet preview
		const passage = `Acme employs ${'x'.repeat(400)} people.`
		const { exit } = runSearch(200, {
			data: { web: [{ url: 'https://acme.es', description: passage }] },
		})

		// THEN content keeps every word, so a fact late in the passage can still
		// be cited, while the snippet carries only the opening as a preview
		const resolved = await exit
		const result = Exit.isSuccess(resolved) ? resolved.value : undefined
		expect(result?.items[0]?.content).toBe(passage)
		expect(result?.items[0]?.snippet).toBe(passage.slice(0, 300))
	})

	it('should carry no content when the passage is only whitespace', async () => {
		// GIVEN a result whose description is blank padding
		const { exit } = runSearch(200, {
			data: { web: [{ url: 'https://acme.es', description: '   \n  ' }] },
		})

		// THEN the item carries no content: empty evidence would still record a
		// source row for a page holding nothing
		const resolved = await exit
		const result = Exit.isSuccess(resolved) ? resolved.value : undefined
		expect(result?.items).toHaveLength(1)
		expect(result?.items[0]?.content).toBeUndefined()
		expect(result?.items[0]?.snippet).toBe('')
	})

	it('should ignore page markdown and keep the passage as its content', async () => {
		// GIVEN a search response that also carries the page's markdown, as it
		// does when a caller asks Firecrawl to fetch each result
		const { exit } = runSearch(200, {
			data: {
				web: [
					{
						url: 'https://acme.es',
						title: 'Acme',
						description: 'Freight forwarder',
						markdown: '# Acme\nFull page content.',
					},
				],
			},
		})

		// THEN the response still decodes and the evidence is the passage alone,
		// so a page body the run never paid for cannot slip in
		const resolved = await exit
		expect(Exit.isSuccess(resolved)).toBe(true)
		const result = Exit.isSuccess(resolved) ? resolved.value : undefined
		expect(result?.items).toHaveLength(1)
		expect(result?.items[0]?.content).toBe('Freight forwarder')
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

	it('should not ask Firecrawl to fetch every result', async () => {
		// GIVEN any successful search
		const { exit, log } = runSearch(200, { data: { web: [] } })
		await exit

		// THEN the request carries no scrape options: they bill a full page read
		// per result, and opening a page stays the job of `scrape_page`
		expect(bodyJson(log.last)).not.toHaveProperty('scrapeOptions')
	})

	it('should ask for the passage of each page that answers the query', async () => {
		// GIVEN any successful search
		const { exit, log } = runSearch(200, { data: { web: [] } })
		await exit

		// THEN the request asks for passages: without the flag each result comes
		// back with the site's generic blurb instead of the text that matched
		expect(bodyJson(log.last)['highlights']).toBe(true)
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

	it('should read a response carrying no `data` block as zero hits', async () => {
		// GIVEN a 2xx answer with no data block — a search that turned nothing up,
		// not a broken response
		const { exit, log } = runSearch(200, { success: true })

		// WHEN it settles
		const settled = await exit

		// THEN the search succeeds with nothing found
		expect(Exit.isSuccess(settled)).toBe(true)
		if (Exit.isSuccess(settled)) expect(settled.value.items).toEqual([])
		expect(log.count).toBe(1)
	})

	it('should keep a result whose title and passage are explicitly null', async () => {
		// GIVEN a result sending null where a string is documented
		const { exit } = runSearch(200, {
			data: {
				web: [{ url: 'https://acme.es', title: null, description: null }],
			},
		})

		// WHEN it settles
		const settled = await exit

		// THEN the result keeps its place: the URL alone is worth scraping later
		expect(Exit.isSuccess(settled)).toBe(true)
		if (Exit.isSuccess(settled)) {
			expect(settled.value.items).toHaveLength(1)
			expect(settled.value.items[0]?.url).toBe('https://acme.es')
			expect(settled.value.items[0]?.title).toBe('')
			expect(settled.value.items[0]?.snippet).toBe('')
		}
	})

	it('should retry when the provider reports the search itself did not work', async () => {
		// GIVEN a 2xx whose body says the search failed on Firecrawl's side
		const { exit, log } = runSearch(200, { success: false })

		// WHEN it settles — THEN that is worth another try, so it retries to the max
		const resolved = await exit
		expect(errorOf(resolved)?.recoverable).toBe(true)
		expect(log.count).toBe(3)
	})

	it('should fail non-recoverably on a body it cannot read at all', async () => {
		// GIVEN a 2xx whose `data` is not a result block
		const { exit, log } = runSearch(200, { data: 'nonsense' })

		// THEN the decode error is non-recoverable and not retried
		const resolved = await exit
		expect(log.count).toBe(1)
		expect(errorOf(resolved)?.recoverable).toBe(false)
	})
})
