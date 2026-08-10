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
import { ProviderError, UnsupportedSite } from '../../domain/errors'
import { ScrapedPage } from '../../domain/types'
import { keyForSlot } from '../_config'
import { hardenHttp } from '../_http-harden'
import {
	firstText,
	NullableOptional,
	NullableOptionalTextOrList,
} from '../_schema'
import { cleanScrapedMarkdown } from './clean-scraped-markdown'

const SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'

// Subset of the Firecrawl scrape response we read. Unknown fields are ignored.
const ScrapeResponse = Schema.Struct({
	// Firecrawl's own verdict on the fetch, which a 2xx does not guarantee.
	success: NullableOptional(Schema.Boolean),
	// The credits Firecrawl says this fetch consumed. Optional because the field
	// is not on every response shape; a fetch that stays quiet counts as one.
	creditsUsed: NullableOptional(Schema.Number),
	// Firecrawl can answer successfully with no `data` at all. That is an empty
	// page, not a broken response, so it must not sink the whole answer.
	data: NullableOptional(
		Schema.Struct({
			markdown: NullableOptional(Schema.String),
			html: NullableOptional(Schema.String),
			links: NullableOptional(Schema.Array(Schema.String)),
			metadata: NullableOptional(
				Schema.Struct({
					title: NullableOptionalTextOrList,
					language: NullableOptionalTextOrList,
					// The address the page finally resolved to after Firecrawl followed
					// any redirects; `sourceURL` is what we asked for. They differ when
					// the requested domain 301s elsewhere (a rebrand).
					url: NullableOptional(Schema.String),
				}),
			),
		}),
	),
})

const sha256Hex = (input: string): string =>
	createHash('sha256').update(input).digest('hex')

// 429 + 5xx are transient (retry); other 4xx are auth/quota/bad-request (fail fast).
// Shared with the sibling firecrawl/map adapter, which retries on the same codes.
export const statusRecoverable = (status: number): boolean =>
	status === 429 || status >= 500

// Firecrawl answers a fetch of a site it refuses (LinkedIn and other people
// directories) with 403 + a body like {"success":false,"error":"…we do not
// support this site…"}. That is the site being off-limits, not a credential,
// quota, or rate problem — so it is told apart from every other 403 (which stays
// a fail-fast auth/quota error) and surfaced as a skip the run can route around.
const UNSUPPORTED_SITE_PATTERN =
	/unsupported|not\s+support|no longer\s+support/i

const isUnsupportedSiteBody = (body: string): boolean => {
	const errorField = ((): string => {
		try {
			const parsed = JSON.parse(body) as { error?: unknown }
			return typeof parsed.error === 'string' ? parsed.error : body
		} catch {
			return body
		}
	})()
	return UNSUPPORTED_SITE_PATTERN.test(errorField)
}

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
								// Drop <form> blocks. A homepage often opens with a "contact
								// us" pop-up form that renders first, so main-content
								// extraction prepends the whole form; on a long page it can
								// crowd the real body out of the downstream length cap. The
								// facts we want (headcount, services, location) live in prose,
								// never in a form.
								excludeTags: ['form'],
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
							// A 403 whose body says the site is off-limits means Firecrawl
							// refuses to fetch it at all (LinkedIn etc.): surface a skip the
							// run routes around, not a fail-fast error that could starve it.
							if (response.status === 403) {
								const body = yield* response.text.pipe(
									Effect.orElseSucceed(() => ''),
								)
								if (isUnsupportedSiteBody(body)) {
									return yield* Effect.fail(
										new UnsupportedSite({
											provider: 'firecrawl',
											url: input.url,
										}),
									)
								}
							}
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
						// Firecrawl can answer 2xx while saying the fetch itself did not
						// work. That is their side failing and worth another try, so it
						// surfaces as an error rather than as a page that came back empty.
						if (body.success === false) {
							return yield* Effect.fail(
								new ProviderError({
									provider: 'firecrawl',
									message: 'scrape failed: provider reported success=false',
									recoverable: true,
								}),
							)
						}
						const page = body.data
						const metadata = page?.metadata
						// Clean page-builder markup out of the fetched markdown; an empty
						// result means the page was mostly scaffolding, so it carries no
						// content and the loop's grounding check skips it.
						const markdown = cleanScrapedMarkdown(page?.markdown ?? '')
						return new ScrapedPage({
							url: input.url,
							resolvedUrl: metadata?.url ?? undefined,
							markdown,
							html: page?.html ?? undefined,
							links: page?.links ?? undefined,
							title: firstText(metadata?.title),
							language: firstText(metadata?.language),
							contentHash: sha256Hex(markdown),
							// The credits Firecrawl charged, not a flat one per fetch.
							units: body.creditsUsed ?? 1,
						})
					}),
				),
		})
	})
