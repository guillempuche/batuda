/**
 * UK Companies House registry provider — free officer/company lookups via the
 * Companies House Public Data API. Resolves a company by its number (taxId) or
 * by name search → first hit, fetches the profile + officers, and maps active
 * officers to `RegistryRecord.directors`.
 *
 * Auth is HTTP Basic with the API key as the username and a blank password
 * (`Basic base64("<key>:")`) — distinct from libreBORME's AccessId:AccessKey
 * pair and Hunter's `?api_key=` query param.
 *
 * @see https://developer.company-information.service.gov.uk/
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

const BASE_URL = 'https://api.company-information.service.gov.uk'

const NullableString = Schema.optional(Schema.NullOr(Schema.String))

const SearchResponse = Schema.Struct({
	items: Schema.optional(
		Schema.Array(
			Schema.Struct({
				company_number: Schema.String,
				title: NullableString,
			}),
		),
	),
})

const Address = Schema.Struct({
	address_line_1: NullableString,
	address_line_2: NullableString,
	locality: NullableString,
	region: NullableString,
	postal_code: NullableString,
	country: NullableString,
})

const CompanyProfile = Schema.Struct({
	company_name: NullableString,
	company_number: NullableString,
	company_status: NullableString,
	date_of_creation: NullableString,
	registered_office_address: Schema.optional(Schema.NullOr(Address)),
	sic_codes: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
})

const OfficersResponse = Schema.Struct({
	items: Schema.optional(
		Schema.Array(
			Schema.Struct({
				name: NullableString,
				officer_role: NullableString,
				appointed_on: NullableString,
				resigned_on: NullableString,
			}),
		),
	),
})

// 429 + 5xx are transient (retry); 401/404/400 are terminal for this request.
const statusRecoverable = (status: number): boolean =>
	status === 429 || status >= 500

const failStatus = (status: number) =>
	Effect.fail(
		new ProviderError({
			provider: 'companies-house',
			message: `registry lookup failed: HTTP ${status}`,
			recoverable: statusRecoverable(status),
		}),
	)

const formatAddress = (
	a: Schema.Schema.Type<typeof Address> | null | undefined,
): string | undefined => {
	if (!a) return undefined
	const parts = [
		a.address_line_1,
		a.address_line_2,
		a.locality,
		a.region,
		a.postal_code,
		a.country,
	].filter((p): p is string => !!p)
	return parts.length > 0 ? parts.join(', ') : undefined
}

export const makeCompaniesHouseRegistry = (slot: number) =>
	Effect.gen(function* () {
		const apiKey = yield* Config.redacted(
			keyForSlot('RESEARCH_API_KEY_REGISTRY_GB', slot),
		)
		const client = yield* HttpClient.HttpClient
		const harden = hardenHttp('companies-house')
		const authHeader = `Basic ${Buffer.from(`${Redacted.value(apiKey)}:`).toString('base64')}`
		const headers = { Authorization: authHeader, Accept: 'application/json' }

		const getJson = <A>(url: string, schema: Schema.Codec<A>) =>
			Effect.gen(function* () {
				const response = yield* client
					.execute(HttpClientRequest.get(url, { headers }))
					.pipe(
						Effect.mapError(
							e =>
								new ProviderError({
									provider: 'companies-house',
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
								provider: 'companies-house',
								message: `unexpected registry response: ${e}`,
								recoverable: false,
							}),
					),
				)
			})

		// Resolve the company number: an explicit taxId is the number; otherwise
		// take the top search hit for the name.
		const resolveNumber = (input: RegistryInput) =>
			Effect.gen(function* () {
				if (input.taxId) return input.taxId
				if (input.query) {
					const search = yield* getJson(
						`${BASE_URL}/search/companies?q=${encodeURIComponent(input.query)}`,
						SearchResponse,
					)
					const top = search.items?.[0]
					if (!top) {
						return yield* new ProviderError({
							provider: 'companies-house',
							message: `no company matched "${input.query}"`,
							recoverable: false,
						})
					}
					return top.company_number
				}
				return yield* new ProviderError({
					provider: 'companies-house',
					message: 'registry lookup needs a taxId or query',
					recoverable: false,
				})
			})

		return RegistryRouter.of({
			lookup: (input: RegistryInput) =>
				harden(
					Effect.gen(function* () {
						const number = yield* resolveNumber(input)
						const profile = yield* getJson(
							`${BASE_URL}/company/${encodeURIComponent(number)}`,
							CompanyProfile,
						)
						const officers = yield* getJson(
							`${BASE_URL}/company/${encodeURIComponent(number)}/officers`,
							OfficersResponse,
						)
						// Only sitting officers — drop anyone with a resignation date.
						const active = (officers.items ?? []).filter(o => !o.resigned_on)
						return new RegistryRecord({
							legalName: profile.company_name ?? '',
							taxId: profile.company_number ?? number,
							status: profile.company_status ?? undefined,
							incorporationDate: profile.date_of_creation ?? undefined,
							address: formatAddress(profile.registered_office_address),
							sector: profile.sic_codes?.join(',') ?? undefined,
							directors: active.map(o => ({
								name: o.name ?? '',
								role: o.officer_role ?? undefined,
								since: o.appointed_on ?? undefined,
							})),
							raw: { profile, officers },
							units: 1,
						})
					}),
				),
		})
	})
