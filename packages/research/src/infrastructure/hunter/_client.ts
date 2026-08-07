/**
 * Shared HTTP plumbing for the Hunter.io v2 endpoints (Domain Search, Email
 * Verifier). Auth is the API key in the `X-API-KEY` header — Hunter also takes
 * it as an `?api_key=` query parameter, but the HTTP client records the whole
 * URL on the trace and blanks out only a few header names, `x-api-key` among
 * them, so the header is the one place the key stays private.
 *
 * Hunter's two rejection codes are the reverse of the usual convention, so they
 * are easy to read backwards: 403 is the per-second rate limit and is worth
 * retrying, while 429 means the plan's monthly allowance is spent and retrying
 * only burns time. 5xx is transient as anywhere else; every other non-2xx is
 * terminal.
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
	status === 403 || status >= 500

/** True when Hunter refused because the plan's allowance for the month is spent. */
export const isQuotaExhausted = (status: number): boolean => status === 429

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
		// endpoint-specific querystring (already encoded) and never the key.
		const getJson = <A>(path: string, query: string, schema: Schema.Codec<A>) =>
			Effect.gen(function* () {
				const url = `${HUNTER_BASE_URL}/${path}?${query}`
				const request = HttpClientRequest.setHeader(
					HttpClientRequest.get(url),
					'X-API-KEY',
					key,
				)
				const response = yield* client.execute(request).pipe(
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
							quotaExhausted: isQuotaExhausted(response.status),
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
