/**
 * Brave LLM Context provider — web search whose results are pre-extracted,
 * relevance-ranked page content built for a model to read, not a person.
 *
 * A normal search returns links plus a one-line snippet; this endpoint returns,
 * for each result, the actual passages of the page that answer the query, each
 * still carrying its own source URL. That lands directly in this pipeline's
 * grounding model — every value ties back to the page it came from — and, because
 * Brave ranks by relevance across its whole index in the requested language, it
 * finds a company's leadership or headquarters wherever it lives on the web
 * regardless of the site's language or how its pages are named, without guessing
 * URLs or crawling. It reuses the same Brave subscription key as the plain search
 * provider, so switching a search slot to this vendor needs no new key.
 *
 * The extracted passages include third-party aggregators (company-profile sites),
 * not just the company's own site — richer recall, but the source-tier guard
 * downstream is what keeps an aggregator's estimate from being trusted like the
 * company's own page.
 *
 * @see https://api-dashboard.search.brave.com/documentation/services/llm-context
 */

import { Config, Effect, Redacted, Schema } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/unstable/http'

import { type SearchInput, SearchProvider } from '../../application/ports'
import { parseCountryAlpha2 } from '../../domain/country'
import { ProviderError } from '../../domain/errors'
import { SearchResult, SearchResultItem } from '../../domain/types'
import { keyForSlot } from '../_config'
import { hardenHttp } from '../_http-harden'

// Context budget returned per request and per source page. Set to Brave's own
// defaults (total 8192 of 1024–32768; per-url 4096 of 512–8192): billing is
// per request, not per token, so a larger budget costs nothing extra and only
// helps recall. Kept at the default rather than higher because the phase-2 prompt
// caps the fetched-page text it reads anyway (MAX_EXTRACTION_PAGE_CHARS), so more
// context here would be truncated there.
const MAX_CONTEXT_TOKENS = 8192
const MAX_TOKENS_PER_URL = 4096

// ── Brave LLM Context response schema (subset we care about) ──

// One source's extracted passages. `snippets` may hold plain prose or
// JSON-serialized structured data (an FAQ block, a table); both read as text.
const GroundingItem = Schema.Struct({
	url: Schema.String,
	title: Schema.optional(Schema.String),
	snippets: Schema.optional(Schema.Array(Schema.String)),
})

const LlmContextResponse = Schema.Struct({
	grounding: Schema.optional(
		Schema.Struct({
			generic: Schema.optional(Schema.Array(GroundingItem)),
		}),
	),
})

// Brave's freshness takes discrete buckets (past day/week/month/year), never a
// "past N days" number, so map the requested window to the nearest bucket.
const freshnessForRecency = (days: number): string =>
	days <= 1 ? 'pd' : days <= 7 ? 'pw' : days <= 31 ? 'pm' : 'py'

// ── Provider factory ──

export const makeBraveLlmContextSearch = (slot: number) =>
	Effect.gen(function* () {
		const apiKey = yield* Config.redacted(
			keyForSlot('RESEARCH_API_KEY_SEARCH', slot),
		)
		const client = yield* HttpClient.HttpClient
		const harden = hardenHttp('brave-context')

		return SearchProvider.of({
			search: (input: SearchInput) =>
				harden(
					Effect.gen(function* () {
						const country = parseCountryAlpha2(input.country)
						const response = yield* client
							.get('https://api.search.brave.com/res/v1/llm/context', {
								headers: {
									Accept: 'application/json',
									'Accept-Encoding': 'gzip',
									'X-Subscription-Token': Redacted.value(apiKey),
								},
								urlParams: {
									q: input.query,
									count: String(input.limit ?? 10),
									maximum_number_of_tokens: String(MAX_CONTEXT_TOKENS),
									maximum_number_of_tokens_per_url: String(MAX_TOKENS_PER_URL),
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
											provider: 'brave-context',
											message: String(e),
											recoverable: true,
										}),
								),
							)
						// A failed call (bad key → 401, quota → 429) must surface as an
						// error, not decode to an empty grounding that looks like a clean
						// zero-hit — otherwise the retry harness and the cross-vendor
						// fallback never see the failure.
						if (response.status < 200 || response.status >= 300) {
							return yield* Effect.fail(
								new ProviderError({
									provider: 'brave-context',
									message: `llm-context failed: HTTP ${response.status}`,
									recoverable:
										response.status === 429 || response.status >= 500,
								}),
							)
						}
						const body = yield* HttpClientResponse.schemaBodyJson(
							LlmContextResponse,
						)(response).pipe(
							Effect.mapError(
								e =>
									new ProviderError({
										provider: 'brave-context',
										message: `unexpected llm-context response: ${e}`,
										recoverable: false,
									}),
							),
						)
						return new SearchResult({
							// Each extracted source becomes a result whose `content` is the
							// grounding passages — real page text the run can cite, not just a
							// snippet. Drop any item with no usable text.
							items: (body.grounding?.generic ?? []).flatMap(item => {
								const content = (item.snippets ?? [])
									.map(s => s.trim())
									.filter(s => s.length > 0)
									.join('\n\n')
								if (content.length === 0) return []
								return [
									new SearchResultItem({
										url: item.url,
										title: item.title ?? item.url,
										snippet: content.slice(0, 300),
										content,
									}),
								]
							}),
							units: 1,
						})
					}),
				),
		})
	})
