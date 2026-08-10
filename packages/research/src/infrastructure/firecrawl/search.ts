/**
 * Firecrawl search provider — real web search via the Firecrawl `/v2/search`
 * API. Firecrawl runs the query on its own infra and returns web results
 * (url + title + snippet), the same source the `firecrawl_search` tool uses.
 *
 * Search is discovery only: it reports which pages look relevant and quotes the
 * passage that made each one look that way. Reading a page in full is the
 * separate `scrape_page` step, so the run pays to open just the pages it picks.
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
import { NullableOptional } from '../_schema'

const SEARCH_URL = 'https://api.firecrawl.dev/v2/search'

// Subset of the Firecrawl search response we read. Unknown fields are ignored.
const SearchResponse = Schema.Struct({
	// Firecrawl's own verdict on the search, which a 2xx does not guarantee.
	success: NullableOptional(Schema.Boolean),
	// A search that turned nothing up can answer with no `data` block at all.
	// That is zero hits, not a broken response.
	data: NullableOptional(
		Schema.Struct({
			web: NullableOptional(
				Schema.Array(
					Schema.Struct({
						url: Schema.String,
						title: NullableOptional(Schema.String),
						// The passage of the page that matched the query, picked by
						// Firecrawl. Falls back to the site's own blurb when the page has
						// no matching passage.
						description: NullableOptional(Schema.String),
					}),
				),
			),
		}),
	),
	// Total credits this call actually cost.
	creditsUsed: NullableOptional(Schema.Number),
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
								// Ask for the passage of each page that answers the query; a
								// result otherwise carries only the site's generic blurb,
								// which rarely says anything about the company. The passage
								// costs nothing extra, while asking for the pages themselves
								// would bill a full page read per result — opening a page
								// stays a step of its own.
								highlights: true,
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
						// A 2xx that says the search itself did not work is their side
						// failing and worth another try, not a clean zero-hit answer.
						if (body.success === false) {
							return yield* Effect.fail(
								new ProviderError({
									provider: 'firecrawl',
									message: 'search failed: provider reported success=false',
									recoverable: true,
								}),
							)
						}
						return new SearchResult({
							items: (body.data?.web ?? []).map(r => {
								// The passage is real text off the page, so the run can cite
								// it and count it as evidence without paying to open the
								// page. A result with no passage still keeps its place: the
								// URL alone is worth scraping later.
								const passage = (r.description ?? '').trim()
								return new SearchResultItem({
									url: r.url,
									title: r.title ?? '',
									// A preview at the same cut-off the Brave context adapter
									// uses; the whole passage goes in `content` below.
									snippet: passage.slice(0, 300),
									...(passage.length > 0 ? { content: passage } : {}),
								})
							}),
							// Bill the credits Firecrawl actually charged, not a flat 1, so
							// the run budget is honest.
							units: body.creditsUsed ?? 1,
						})
					}),
				),
		})
	})
