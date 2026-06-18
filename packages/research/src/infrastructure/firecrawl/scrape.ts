/**
 * Firecrawl scrape provider — real page fetch + markdown via the Firecrawl
 * `/v2/scrape` API. Firecrawl fetches the URL on its own infra, so this
 * adapter makes no arbitrary outbound request itself (no SSRF surface here).
 *
 * Follows the `brave/search.ts` template (Config.redacted key → HttpClient →
 * Schema-decoded body → ProviderError), plus the shared `hardenHttp` wrapper
 * for timeout + recoverable-only retry.
 *
 * @see https://docs.firecrawl.dev/api-reference/endpoint/scrape
 */

import { createHash } from 'node:crypto'

import { Config, Effect, Redacted, Schema } from 'effect'
import {
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
} from 'effect/unstable/http'

import { type ScrapeInput, ScrapeProvider } from '../../application/ports'
import { ProviderError } from '../../domain/errors'
import { ScrapedPage } from '../../domain/types'
import { keyForSlot } from '../_config'
import { hardenHttp } from '../_http-harden'

const SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'

// Subset of the Firecrawl scrape response we read. Unknown fields are ignored.
const ScrapeResponse = Schema.Struct({
	data: Schema.Struct({
		markdown: Schema.optional(Schema.String),
		html: Schema.optional(Schema.String),
		links: Schema.optional(Schema.Array(Schema.String)),
		metadata: Schema.optional(
			Schema.Struct({
				title: Schema.optional(Schema.String),
				language: Schema.optional(Schema.String),
			}),
		),
	}),
})

const sha256Hex = (input: string): string =>
	createHash('sha256').update(input).digest('hex')

// 429 + 5xx are transient (retry); other 4xx are auth/quota/bad-request (fail fast).
const statusRecoverable = (status: number): boolean =>
	status === 429 || status >= 500

export const makeFirecrawlScrape = (slot: number) =>
	Effect.gen(function* () {
		const apiKey = yield* Config.redacted(
			keyForSlot('RESEARCH_API_KEY_SCRAPE', slot),
		)
		const client = yield* HttpClient.HttpClient
		const harden = hardenHttp('firecrawl')

		return ScrapeProvider.of({
			scrape: (input: ScrapeInput) =>
				harden(
					Effect.gen(function* () {
						const request = HttpClientRequest.post(SCRAPE_URL).pipe(
							HttpClientRequest.setHeaders({
								Authorization: `Bearer ${Redacted.value(apiKey)}`,
								Accept: 'application/json',
							}),
							HttpClientRequest.bodyJsonUnsafe({
								url: input.url,
								formats: input.formats ?? ['markdown'],
								onlyMainContent: true,
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
									message: `scrape failed: HTTP ${response.status}`,
									recoverable: statusRecoverable(response.status),
								}),
							)
						}
						const body = yield* HttpClientResponse.schemaBodyJson(
							ScrapeResponse,
						)(response).pipe(
							Effect.mapError(
								e =>
									new ProviderError({
										provider: 'firecrawl',
										message: `unexpected scrape response: ${e}`,
										recoverable: false,
									}),
							),
						)
						const markdown = body.data.markdown ?? ''
						return new ScrapedPage({
							url: input.url,
							markdown,
							html: body.data.html,
							links: body.data.links,
							title: body.data.metadata?.title,
							language: body.data.metadata?.language,
							contentHash: sha256Hex(markdown),
							units: 1,
						})
					}),
				),
		})
	})
