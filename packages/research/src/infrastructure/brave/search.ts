/**
 * Brave Search provider — real web search via the Brave Search API.
 *
 * Exposes a factory (`makeBraveSearch(slot)`) that reads an index-suffixed API
 * key, so a run can hold more than one account for the same vendor. This file
 * serves as the **template** for adding new real providers.
 *
 * @see https://api.search.brave.com/app/documentation/web-search
 */

import { Config, Effect, Redacted, Schema } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/unstable/http'

import { type SearchInput, SearchProvider } from '../../application/ports'
import { parseCountryAlpha2 } from '../../domain/country'
import { ProviderError } from '../../domain/errors'
import { SearchResult, SearchResultItem } from '../../domain/types'
import { keyForSlot } from '../_config'
import { hardenHttp } from '../_http-harden'

// ── Brave API response schema (subset we care about) ──

const BraveWebResult = Schema.Struct({
	title: Schema.String,
	url: Schema.String,
	description: Schema.String,
	page_age: Schema.optional(Schema.String),
	// Up to 5 additional excerpts from the page (requested via extra_snippets) —
	// richer grounding context than the single description line.
	extra_snippets: Schema.optional(Schema.Array(Schema.String)),
})

const BraveSearchResponse = Schema.Struct({
	web: Schema.optional(
		Schema.Struct({
			results: Schema.Array(BraveWebResult),
		}),
	),
})

// Brave's freshness takes discrete buckets (past day/week/month/year) or an
// explicit date range — never a "past N days" number — so map the requested
// window to the nearest bucket. (The old `pd<days>` form was silently invalid.)
const freshnessForRecency = (days: number): string =>
	days <= 1 ? 'pd' : days <= 7 ? 'pw' : days <= 31 ? 'pm' : 'py'

// ── Provider factory ──

export const makeBraveSearch = (slot: number) =>
	Effect.gen(function* () {
		const apiKey = yield* Config.redacted(
			keyForSlot('RESEARCH_API_KEY_SEARCH', slot),
		)
		const client = yield* HttpClient.HttpClient
		// Bound each request and retry transient failures, so a hung Brave socket
		// can't pin a research fiber and a blip doesn't fail the run.
		const harden = hardenHttp('brave')

		return SearchProvider.of({
			search: (input: SearchInput) =>
				harden(
					Effect.gen(function* () {
						// Brave's `country` wants an upper-case two-letter code; a raw model
						// hint like "en-US" is invalid, so normalize it or leave it out.
						const country = parseCountryAlpha2(input.country)
						const response = yield* client
							.get('https://api.search.brave.com/res/v1/web/search', {
								headers: {
									Accept: 'application/json',
									'Accept-Encoding': 'gzip',
									'X-Subscription-Token': Redacted.value(apiKey),
								},
								urlParams: {
									q: input.query,
									count: String(input.limit ?? 10),
									// Ask for extra excerpts per result for richer context.
									extra_snippets: 'true',
									...(input.recency
										? { freshness: freshnessForRecency(input.recency.days) }
										: {}),
									...(country ? { country } : {}),
									...(input.languages?.[0]
										? { search_lang: input.languages[0] }
										: {}),
								},
							})
							.pipe(
								Effect.mapError(
									e =>
										new ProviderError({
											provider: 'brave',
											message: String(e),
											recoverable: true,
										}),
								),
							)
						// A failed Brave call (bad key → 401, quota → 429) must surface as
						// an error. Without this the body would decode with `web` absent and
						// look like a successful zero-hit — hiding the failure from both the
						// retry harness and the cross-vendor fallback.
						if (response.status < 200 || response.status >= 300) {
							return yield* Effect.fail(
								new ProviderError({
									provider: 'brave',
									message: `search failed: HTTP ${response.status}`,
									recoverable:
										response.status === 429 || response.status >= 500,
								}),
							)
						}
						const body = yield* HttpClientResponse.schemaBodyJson(
							BraveSearchResponse,
						)(response).pipe(
							Effect.mapError(
								e =>
									new ProviderError({
										provider: 'brave',
										message: `unexpected search response: ${e}`,
										recoverable: false,
									}),
							),
						)
						return new SearchResult({
							items: (body.web?.results ?? []).map(r => {
								const extra = (r.extra_snippets ?? []).join('\n')
								return new SearchResultItem({
									url: r.url,
									title: r.title,
									snippet: r.description,
									...(extra.length > 0 ? { content: extra } : {}),
								})
							}),
							units: 1,
						})
					}),
				),
		})
	})
