/**
 * Shared HTTP plumbing for the Hunter.io v2 endpoints (Domain Search, Email
 * Verifier). Auth is the API key as a `?api_key=` query parameter — NOT HTTP
 * Basic like libreBORME. 429/5xx are transient (retried by the harness); any
 * other non-2xx status is terminal for the request.
 *
 * @see https://hunter.io/api-documentation/v2
 */

import { Config, Effect, Redacted, Schema } from 'effect'
import {
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
} from 'effect/unstable/http'

import { ProviderError } from '../../domain/errors'
import type { VerificationVerdict } from '../../domain/types'
import { keyForSlot } from '../_config'
import { hardenHttp } from '../_http-harden'

const HUNTER_BASE_URL = 'https://api.hunter.io/v2'

export const HunterNullableString = Schema.optional(
	Schema.NullOr(Schema.String),
)
export const HunterNullableNumber = Schema.optional(
	Schema.NullOr(Schema.Number),
)
export const HunterNullableBoolean = Schema.optional(
	Schema.NullOr(Schema.Boolean),
)

const statusRecoverable = (status: number): boolean =>
	status === 429 || status >= 500

// Hunter's per-email verification status (from Domain Search) → pipeline verdict.
// `undefined` when Hunter has no status yet, so the caller falls through to a
// dedicated verifier call.
export const hunterStatusToVerdict = (
	status: string | null | undefined,
): VerificationVerdict | undefined => {
	switch (status) {
		case 'valid':
			return 'deliverable'
		case 'invalid':
			return 'undeliverable'
		case 'accept_all':
			return 'catch_all'
		case 'webmail':
		case 'disposable':
		case 'unknown':
			return 'unknown'
		default:
			return undefined
	}
}

/**
 * Build a Hunter HTTP helper for one capability slot. `envBase` is the API-key
 * variable (`RESEARCH_API_KEY_ENRICH` / `RESEARCH_API_KEY_VERIFY`) so the two
 * endpoints can carry independent keys behind the same plumbing.
 */
export const makeHunterClient = (envBase: string, slot: number) =>
	Effect.gen(function* () {
		const apiKey = yield* Config.redacted(keyForSlot(envBase, slot))
		const client = yield* HttpClient.HttpClient
		const harden = hardenHttp('hunter')
		const key = Redacted.value(apiKey)

		// One authenticated GET, decoded against `schema`. `query` is the
		// endpoint-specific querystring (already encoded); the api_key is appended.
		const getJson = <A>(path: string, query: string, schema: Schema.Codec<A>) =>
			Effect.gen(function* () {
				const url = `${HUNTER_BASE_URL}/${path}?${query}&api_key=${encodeURIComponent(key)}`
				const response = yield* client.execute(HttpClientRequest.get(url)).pipe(
					Effect.mapError(
						e =>
							new ProviderError({
								provider: 'hunter',
								message: String(e),
								recoverable: true,
							}),
					),
				)
				if (response.status < 200 || response.status >= 300) {
					return yield* Effect.fail(
						new ProviderError({
							provider: 'hunter',
							message: `Hunter ${path} failed: HTTP ${response.status}`,
							recoverable: statusRecoverable(response.status),
						}),
					)
				}
				return yield* HttpClientResponse.schemaBodyJson(schema)(response).pipe(
					Effect.mapError(
						e =>
							new ProviderError({
								provider: 'hunter',
								message: `unexpected Hunter ${path} response: ${e}`,
								recoverable: false,
							}),
					),
				)
			})

		return { harden, getJson }
	})
