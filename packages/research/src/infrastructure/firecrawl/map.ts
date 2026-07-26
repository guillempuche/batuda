/**
 * Firecrawl site-map provider — discovers a site's own page URLs via the
 * Firecrawl `/v2/map` API (sitemap + crawl), so a run can reach a team or
 * about page the homepage never links. Firecrawl walks the site on its own
 * infra, so this adapter makes no arbitrary outbound request itself.
 *
 * Follows the `firecrawl/scrape.ts` template (Config.redacted key →
 * HttpClient → Schema-decoded body → ProviderError), plus the shared
 * `hardenHttp` wrapper for timeout + recoverable-only retry.
 *
 * @see https://docs.firecrawl.dev/api-reference/endpoint/map
 */

import { Config, Effect, Redacted, Schema } from 'effect'
import {
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
} from 'effect/unstable/http'

import { MapProvider, type SiteMapInput } from '../../application/ports'
import { ProviderError } from '../../domain/errors'
import { keyForSlot } from '../_config'
import { hardenHttp } from '../_http-harden'
import { statusRecoverable } from './scrape'

const MAP_URL = 'https://api.firecrawl.dev/v2/map'

// The API has answered with both bare URL strings and {url} objects across
// versions; accept either so a format change doesn't break discovery.
const MapResponse = Schema.Struct({
	creditsUsed: Schema.optional(Schema.Number),
	links: Schema.optional(
		Schema.Array(
			Schema.Union([Schema.String, Schema.Struct({ url: Schema.String })]),
		),
	),
})

export const makeFirecrawlMap = (slot: number) =>
	Effect.gen(function* () {
		// Mapping a site and scraping a page are the same Firecrawl account behind
		// the same key. Accept a dedicated map key for the org that wants to meter
		// discovery separately, and otherwise reuse the scrape key — so turning
		// discovery on never means provisioning a second copy of a secret that is
		// already deployed, and forgetting to cannot stop the server booting.
		const apiKey = yield* Config.redacted(
			keyForSlot('RESEARCH_API_KEY_MAP', slot),
		).pipe(
			Config.orElse(() =>
				Config.redacted(keyForSlot('RESEARCH_API_KEY_SCRAPE', slot)),
			),
		)
		const client = yield* HttpClient.HttpClient
		const harden = hardenHttp('firecrawl')

		return MapProvider.of({
			map: (input: SiteMapInput) =>
				harden(
					Effect.gen(function* () {
						const request = HttpClientRequest.post(MAP_URL).pipe(
							HttpClientRequest.setHeaders({
								Authorization: `Bearer ${Redacted.value(apiKey)}`,
								Accept: 'application/json',
							}),
							HttpClientRequest.bodyJsonUnsafe({
								url: input.url,
								...(input.limit !== undefined ? { limit: input.limit } : {}),
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
									message: `map failed: HTTP ${response.status}`,
									recoverable: statusRecoverable(response.status),
								}),
							)
						}
						const body = yield* HttpClientResponse.schemaBodyJson(MapResponse)(
							response,
						).pipe(
							Effect.mapError(
								e =>
									new ProviderError({
										provider: 'firecrawl',
										message: `unexpected map response: ${e}`,
										recoverable: false,
									}),
							),
						)
						return {
							links: (body.links ?? []).map(link =>
								typeof link === 'string' ? link : link.url,
							),
							// Bill what Firecrawl says it charged; walking a site is not a
							// flat-price call.
							units: body.creditsUsed ?? 1,
						}
					}),
				),
		})
	})
