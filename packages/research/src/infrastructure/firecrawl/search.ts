/**
 * Firecrawl search provider — real web search via the Firecrawl `/v2/search`
 * API. Firecrawl runs the query on its own infra and returns web results
 * (url + title + snippet), the same source the `firecrawl_search` tool uses.
 *
 * Mirrors the `firecrawl/scrape.ts` adapter (Config.redacted key → HttpClient →
 * Schema-decoded body → ProviderError) with the shared `hardenHttp` wrapper for
 * timeout + recoverable-only retry. Reads the same `RESEARCH_API_KEY_SEARCH`
 * slot the Brave provider does, so switching the search vendor needs no new key.
 *
 * @see https://docs.firecrawl.dev/api-reference/endpoint/search
 */

import { Config, Effect, Redacted, Schema } from 'effect'
import {
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
} from 'effect/unstable/http'

import { type SearchInput, SearchProvider } from '../../application/ports'
import { parseCountryAlpha2 } from '../../domain/country'
import { ProviderError } from '../../domain/errors'
import { SearchResult, SearchResultItem } from '../../domain/types'
import { keyForSlot } from '../_config'
import { hardenHttp } from '../_http-harden'
import { cleanScrapedMarkdown } from './clean-scraped-markdown'

const SEARCH_URL = 'https://api.firecrawl.dev/v2/search'

// Subset of the Firecrawl search response we read. Unknown fields are ignored.
const SearchResponse = Schema.Struct({
	data: Schema.Struct({
		web: Schema.optional(
			Schema.Array(
				Schema.Struct({
					url: Schema.String,
					title: Schema.optional(Schema.String),
					description: Schema.optional(Schema.String),
					// Present when scrapeOptions asked for it — the page's main content.
					markdown: Schema.optional(Schema.String),
				}),
			),
		),
	}),
	// Total credits this call actually cost (search + per-result scraping).
	creditsUsed: Schema.optional(Schema.Number),
})

// 429 + 5xx are transient (retry); other 4xx are auth/quota/bad-request (fail fast).
const statusRecoverable = (status: number): boolean =>
	status === 429 || status >= 500

// Map a recency window (in days) to Firecrawl's time-based-search bucket: past
// day / week / month / year. Coarser than Brave's exact `pd<days>`, but the API
// only exposes these buckets.
const tbsForRecency = (days: number): string =>
	days <= 1 ? 'qdr:d' : days <= 7 ? 'qdr:w' : days <= 31 ? 'qdr:m' : 'qdr:y'

export const makeFirecrawlSearch = (slot: number) =>
	Effect.gen(function* () {
		const apiKey = yield* Config.redacted(
			keyForSlot('RESEARCH_API_KEY_SEARCH', slot),
		)
		const client = yield* HttpClient.HttpClient
		const harden = hardenHttp('firecrawl')

		return SearchProvider.of({
			search: (input: SearchInput) =>
				harden(
					Effect.gen(function* () {
						// Firecrawl's `country` wants a lower-case two-letter code; a raw
						// model hint like "en-US" is rejected (422), so normalize or drop it.
						const country = parseCountryAlpha2(input.location)
						const request = HttpClientRequest.post(SEARCH_URL).pipe(
							HttpClientRequest.setHeaders({
								Authorization: `Bearer ${Redacted.value(apiKey)}`,
								Accept: 'application/json',
							}),
							HttpClientRequest.bodyJsonUnsafe({
								query: input.query,
								limit: input.limit ?? 10,
								// Web results only — skip the news/image sources the research
								// loop has no way to scrape or cite.
								sources: [{ type: 'web' }],
								// Return each result's main content as markdown, so one
								// search can ground the run without a separate scrape.
								// Drop <form> blocks so a "contact us" pop-up form doesn't
								// stand in for the page body (same fix as the scrape adapter).
								scrapeOptions: {
									formats: ['markdown'],
									onlyMainContent: true,
									excludeTags: ['form'],
								},
								...(input.recency
									? { tbs: tbsForRecency(input.recency.days) }
									: {}),
								...(country ? { country: country.toLowerCase() } : {}),
							}),
						)
						const response = yield* client.execute(request).pipe(
							Effect.mapError(
								e =>
									new ProviderError({
										provider: 'firecrawl',
										message: String(e),
										recoverable: true,
									}),
							),
						)
						if (response.status < 200 || response.status >= 300) {
							return yield* Effect.fail(
								new ProviderError({
									provider: 'firecrawl',
									message: `search failed: HTTP ${response.status}`,
									recoverable: statusRecoverable(response.status),
								}),
							)
						}
						const body = yield* HttpClientResponse.schemaBodyJson(
							SearchResponse,
						)(response).pipe(
							Effect.mapError(
								e =>
									new ProviderError({
										provider: 'firecrawl',
										message: `unexpected search response: ${e}`,
										recoverable: false,
									}),
							),
						)
						return new SearchResult({
							items: (body.data.web ?? []).map(r => {
								// Clean page-builder markup out of the scraped content before
								// it becomes grounding evidence; an empty result means the page
								// was mostly scaffolding, so the item carries no content.
								const content = cleanScrapedMarkdown(r.markdown ?? '')
								return new SearchResultItem({
									url: r.url,
									title: r.title ?? '',
									snippet: r.description ?? '',
									...(content.length > 0 ? { content } : {}),
								})
							}),
							// Bill the credits Firecrawl actually charged (search plus the
							// per-result scrape), not a flat 1, so the run budget is honest.
							units: body.creditsUsed ?? 1,
						})
					}),
				),
		})
	})
