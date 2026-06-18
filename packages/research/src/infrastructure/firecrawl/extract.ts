/**
 * Firecrawl extract provider — structured extraction from a single URL via the
 * Firecrawl `/v2/scrape` API with the `json` format (the standalone `/extract`
 * endpoint was consolidated into scrape).
 *
 * The caller passes an Effect `Schema`; Firecrawl needs a JSON Schema, so we
 * bridge with `Schema.toJsonSchemaDocument`. The returned value is `unknown` —
 * the research tool loop decodes it against the same Effect schema, so a
 * shape mismatch surfaces there rather than being silently trusted.
 *
 * Note: only the root schema is sent; a schema carrying `$defs`/definitions
 * would need them inlined. The registry schemas used today are flat, so this
 * is sufficient — revisit if a nested extraction schema is added.
 *
 * @see https://docs.firecrawl.dev/features/extract
 */

import { Config, Effect, Redacted, Schema } from 'effect'
import {
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
} from 'effect/unstable/http'

import { type ExtractInput, ExtractProvider } from '../../application/ports'
import { ProviderError } from '../../domain/errors'
import { keyForSlot } from '../_config'
import { hardenHttp } from '../_http-harden'

const SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'

const ExtractResponse = Schema.Struct({
	data: Schema.Struct({
		json: Schema.optional(Schema.Unknown),
	}),
})

// 429 + 5xx are transient (retry); other 4xx are auth/quota/bad-request (fail fast).
const statusRecoverable = (status: number): boolean =>
	status === 429 || status >= 500

export const makeFirecrawlExtract = (slot: number) =>
	Effect.gen(function* () {
		const apiKey = yield* Config.redacted(
			keyForSlot('RESEARCH_API_KEY_EXTRACT', slot),
		)
		const client = yield* HttpClient.HttpClient
		const harden = hardenHttp('firecrawl')

		return ExtractProvider.of({
			extract: (input: ExtractInput) =>
				harden(
					Effect.gen(function* () {
						const jsonSchema: unknown = Schema.toJsonSchemaDocument(
							input.schema,
						).schema
						const request = HttpClientRequest.post(SCRAPE_URL).pipe(
							HttpClientRequest.setHeaders({
								Authorization: `Bearer ${Redacted.value(apiKey)}`,
								Accept: 'application/json',
							}),
							HttpClientRequest.bodyJsonUnsafe({
								url: input.url,
								onlyMainContent: true,
								formats: [
									{
										type: 'json',
										schema: jsonSchema,
										...(input.prompt !== undefined
											? { prompt: input.prompt }
											: {}),
									},
								],
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
									message: `extract failed: HTTP ${response.status}`,
									recoverable: statusRecoverable(response.status),
								}),
							)
						}
						const body = yield* HttpClientResponse.schemaBodyJson(
							ExtractResponse,
						)(response).pipe(
							Effect.mapError(
								e =>
									new ProviderError({
										provider: 'firecrawl',
										message: `unexpected extract response: ${e}`,
										recoverable: false,
									}),
							),
						)
						return body.data.json ?? {}
					}),
				),
		})
	})
