/**
 * LibreBOR registry provider — Spanish mercantile registry (BORME) lookups via
 * the LibreBOR API (api.librebor.me/v2). Resolves a company by NIF, or by name
 * search → first match's slug, and maps it to a `RegistryRecord`.
 *
 * Auth is HTTP Basic over an AccessId/AccessKey pair: the single env var holds
 * `AccessId:AccessKey` and the adapter base64-encodes it. The `api.` host is
 * directly reachable (the bot-challenge only fronts the web UI).
 *
 * Free of headcount by design — BORME records identity, capital, and officers,
 * not employee counts.
 *
 * @see https://docs.librebor.me/en/endpoints/ (OpenAPI: /company/by-nif, /company/search, /company/by-slug)
 */

import { Config, Effect, Redacted, Schema } from 'effect'
import {
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
} from 'effect/unstable/http'

import { type RegistryInput, RegistryRouter } from '../../application/ports'
import { ProviderError } from '../../domain/errors'
import { RegistryRecord } from '../../domain/types'
import { keyForSlot } from '../_config'
import { hardenHttp } from '../_http-harden'

const BASE_URL = 'https://api.librebor.me/v2'

// Subset of the LibreBOR Company object we map. `x-nullable` fields arrive as
// null; absent ones are undefined — both tolerated.
const NullableString = Schema.optional(Schema.NullOr(Schema.String))

const Company = Schema.Struct({
	name: Schema.String,
	nif: NullableString,
	status: NullableString,
	capital: Schema.optional(Schema.NullOr(Schema.Number)),
	date_creation: NullableString,
	address: NullableString,
	municipality: NullableString,
	province: NullableString,
	cnae: NullableString,
	active_positions: Schema.optional(
		Schema.Array(
			Schema.Struct({
				name_person: NullableString,
				role: NullableString,
				date_from: NullableString,
			}),
		),
	),
})

const CompanyResponse = Schema.Struct({ company: Company })
const SearchResponse = Schema.Struct({
	companies: Schema.Array(Schema.Struct({ slug: Schema.String })),
})

// 429 + 5xx are transient (retry); 401/402 (bad key / no credit), 404 (not
// found) and 400 (bad NIF) are terminal for this request.
const statusRecoverable = (status: number): boolean =>
	status === 429 || status >= 500

const failStatus = (status: number) =>
	Effect.fail(
		new ProviderError({
			provider: 'librebor',
			message: `registry lookup failed: HTTP ${status}`,
			recoverable: statusRecoverable(status),
		}),
	)

export const makeLibreborRegistry = (slot: number) =>
	Effect.gen(function* () {
		const credential = yield* Config.redacted(
			keyForSlot('RESEARCH_API_KEY_REGISTRY_ES', slot),
		)
		const client = yield* HttpClient.HttpClient
		const harden = hardenHttp('librebor')
		const authHeader = `Basic ${Buffer.from(Redacted.value(credential)).toString('base64')}`
		const headers = { Authorization: authHeader, Accept: 'application/json' }

		// One authenticated GET, decoded against `schema`. 2xx → value; any other
		// status maps to a ProviderError classified for the retry/fallback layer.
		const getJson = <A>(url: string, schema: Schema.Codec<A>) =>
			Effect.gen(function* () {
				const response = yield* client
					.execute(HttpClientRequest.get(url, { headers }))
					.pipe(
						Effect.mapError(
							e =>
								new ProviderError({
									provider: 'librebor',
									message: String(e),
									recoverable: true,
								}),
						),
					)
				if (response.status < 200 || response.status >= 300) {
					return yield* failStatus(response.status)
				}
				return yield* HttpClientResponse.schemaBodyJson(schema)(response).pipe(
					Effect.mapError(
						e =>
							new ProviderError({
								provider: 'librebor',
								message: `unexpected registry response: ${e}`,
								recoverable: false,
							}),
					),
				)
			})

		const toRecord = (company: Schema.Schema.Type<typeof Company>) =>
			new RegistryRecord({
				legalName: company.name,
				taxId: company.nif ?? undefined,
				status: company.status ?? undefined,
				incorporationDate: company.date_creation ?? undefined,
				capital: company.capital != null ? `${company.capital}` : undefined,
				address: company.address ?? undefined,
				municipality: company.municipality ?? undefined,
				province: company.province ?? undefined,
				sector: company.cnae ?? undefined,
				directors: (company.active_positions ?? []).map(p => ({
					name: p.name_person ?? '',
					role: p.role ?? undefined,
					since: p.date_from ?? undefined,
				})),
				raw: company,
				units: 1,
			})

		return RegistryRouter.of({
			lookup: (input: RegistryInput) =>
				harden(
					Effect.gen(function* () {
						// Prefer the exact NIF lookup; otherwise resolve a name to the
						// top search hit's slug, then fetch that company.
						if (input.taxId) {
							const body = yield* getJson(
								`${BASE_URL}/company/by-nif/${encodeURIComponent(input.taxId)}/`,
								CompanyResponse,
							)
							return toRecord(body.company)
						}
						if (input.query) {
							const search = yield* getJson(
								`${BASE_URL}/company/search/?query=${encodeURIComponent(input.query)}&page=1`,
								SearchResponse,
							)
							const top = search.companies[0]
							if (!top) {
								return yield* new ProviderError({
									provider: 'librebor',
									message: `no company matched "${input.query}"`,
									recoverable: false,
								})
							}
							const body = yield* getJson(
								`${BASE_URL}/company/by-slug/${encodeURIComponent(top.slug)}/`,
								CompanyResponse,
							)
							return toRecord(body.company)
						}
						return yield* new ProviderError({
							provider: 'librebor',
							message: 'registry lookup needs a taxId or query',
							recoverable: false,
						})
					}),
				),
		})
	})
