/**
 * Brave Search provider — real web search via the Brave Search API.
 *
 * Pattern: Layer.effect (requires HttpClient + Config at R).
 * This file serves as the **template** for adding new real providers.
 * To create a new provider: copy this file, adjust the URL/schema/mapping.
 *
 * @see https://api.search.brave.com/app/documentation/web-search
 */

import { Config, Effect, Layer, Redacted, Schema } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/unstable/http'

import { type SearchInput, SearchProvider } from '../../application/ports'
import { ProviderError } from '../../domain/errors'
import { SearchResult, SearchResultItem } from '../../domain/types'

// ── Brave API response schema (subset we care about) ──

const BraveWebResult = Schema.Struct({
	title: Schema.String,
	url: Schema.String,
	description: Schema.String,
	page_age: Schema.optional(Schema.String),
})

const BraveSearchResponse = Schema.Struct({
	web: Schema.optional(
		Schema.Struct({
			results: Schema.Array(BraveWebResult),
		}),
	),
})

// ── Provider implementation ──

export const BraveSearchProvider = Layer.effect(
	SearchProvider,
	Effect.gen(function* () {
		const apiKey = yield* Config.redacted('BRAVE_SEARCH_API_KEY')
		const client = yield* HttpClient.HttpClient

		return SearchProvider.of({
			search: (input: SearchInput) =>
				client
					.get('https://api.search.brave.com/res/v1/web/search', {
						headers: {
							Accept: 'application/json',
							'Accept-Encoding': 'gzip',
							'X-Subscription-Token': Redacted.value(apiKey),
						},
						urlParams: {
							q: input.query,
							count: String(input.limit ?? 10),
							...(input.recency
								? {
										freshness: `pd${input.recency.days}`,
									}
								: {}),
							...(input.location ? { country: input.location } : {}),
						},
					})
					.pipe(
						Effect.flatMap(
							HttpClientResponse.schemaBodyJson(BraveSearchResponse),
						),
						Effect.map(
							body =>
								new SearchResult({
									items: (body.web?.results ?? []).map(
										r =>
											new SearchResultItem({
												url: r.url,
												title: r.title,
												snippet: r.description,
											}),
									),
									units: 1,
								}),
						),
						Effect.mapError(
							e =>
								new ProviderError({
									provider: 'brave',
									message: String(e),
									recoverable: true,
								}),
						),
					),
		})
	}),
)
