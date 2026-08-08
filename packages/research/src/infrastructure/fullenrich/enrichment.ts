/**
 * FullEnrich enrichment provider — decision-maker discovery via People Search
 * (app.fullenrich.com, POST /api/v2/people/search). This endpoint is
 * synchronous: it returns the matching people in the response, so it drops
 * straight into the findPeople slot (unlike FullEnrich's async Enrich API).
 *
 * People Search is a prospecting search: a bare company-domain filter returns
 * nobody, so the request pairs the domain with a decision-maker seniority
 * filter to surface the people worth reaching. On the current plan the search
 * returns names + roles but no email — that is fine, the discovery pipeline's
 * guess + MX + verify resolves the address exactly as it does for registry
 * directors. A paid plan (or the Enrich API) adds contact_info, so an email and
 * its deliverability status are read when present.
 *
 * Filters are `{ value, exact_match }` objects (one per value; several combine
 * as OR within a field). The response people carry nested employment + social
 * profiles. Both shapes were confirmed against the live API — the published docs
 * were wrong on the host, the filter shape, and the response field names.
 *
 * @see https://docs.fullenrich.com/api/v2/people/search/post
 */

import { Config, Effect, Redacted, Schema } from 'effect'
import {
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
} from 'effect/unstable/http'

import type { VerificationVerdict } from '@batuda/domain'

import {
	type EnrichmentInput,
	EnrichmentProvider,
} from '../../application/ports'
import { ProviderError } from '../../domain/errors'
import { EnrichmentResult } from '../../domain/types'
import { keyForSlot } from '../_config'
import { hardenHttp } from '../_http-harden'

const PEOPLE_SEARCH_URL = 'https://app.fullenrich.com/api/v2/people/search'

// Cap results per company: decision-maker discovery needs a handful, and each
// returned person costs credits plus a downstream verify, so keep it modest.
const RESULT_LIMIT = 10

// The seniority tiers that make someone worth reaching. A domain-only search
// returns nobody, so the request always narrows to these (FullEnrich's own
// enum values; combined as OR).
const DECISION_MAKER_SENIORITIES = [
	'Owner',
	'Founder',
	'C-level',
	'Partner',
	'VP',
	'Head',
	'Director',
]

// FullEnrich hides some last names on the free plan; treat that sentinel as no
// surname so it never leaks into a name or a guessed email.
const HIDDEN_LAST_NAME = 'HIDDEN_ON_FREE_PLAN'

const NullableString = Schema.optional(Schema.NullOr(Schema.String))

// One email + its deliverability status, as contact_info returns it (paid plan).
const EmailEntry = Schema.Struct({
	email: NullableString,
	status: NullableString,
})

// Only the fields the pipeline reads; unknown ones are ignored. Names sit at the
// top level, the role under employment.current, the LinkedIn URL under
// social_profiles, and any email (when the plan returns it) under contact_info
// or the most_probable_* shortcuts.
const SearchedPerson = Schema.Struct({
	first_name: NullableString,
	last_name: NullableString,
	employment: Schema.optional(
		Schema.NullOr(
			Schema.Struct({
				current: Schema.optional(
					Schema.NullOr(
						Schema.Struct({ title: NullableString, seniority: NullableString }),
					),
				),
			}),
		),
	),
	social_profiles: Schema.optional(
		Schema.NullOr(
			Schema.Struct({
				professional_network: Schema.optional(
					Schema.NullOr(Schema.Struct({ url: NullableString })),
				),
			}),
		),
	),
	most_probable_work_email: Schema.optional(Schema.NullOr(EmailEntry)),
	most_probable_personal_email: Schema.optional(Schema.NullOr(EmailEntry)),
	contact_info: Schema.optional(
		Schema.NullOr(
			Schema.Struct({
				work_emails: Schema.optional(Schema.NullOr(Schema.Array(EmailEntry))),
				personal_emails: Schema.optional(
					Schema.NullOr(Schema.Array(EmailEntry)),
				),
			}),
		),
	),
})

const PeopleSearchResponse = Schema.Struct({
	people: Schema.optional(Schema.Array(SearchedPerson)),
})

// 429 + 5xx are transient (retry); other 4xx are auth/quota/bad-request (fail fast).
const statusRecoverable = (status: number): boolean =>
	status === 429 || status >= 500

// FullEnrich email deliverability status → the pipeline's verdict. Undefined
// when there is no status (the common case: People Search returns no email, so
// the pipeline verifies the guessed address itself).
export const fullEnrichStatusToVerdict = (
	status: string | null | undefined,
): VerificationVerdict | undefined => {
	switch (status?.toUpperCase()) {
		case 'DELIVERABLE':
			return 'deliverable'
		case 'UNDELIVERABLE':
		case 'INVALID':
			return 'undeliverable'
		case 'RISKY':
			return 'risky'
		case 'CATCH_ALL':
		case 'ACCEPT_ALL':
			return 'catch_all'
		case 'UNKNOWN':
			return 'unknown'
		default:
			return undefined
	}
}

export const makeFullEnrichEnrichment = (slot: number) =>
	Effect.gen(function* () {
		const apiKey = yield* Config.redacted(
			keyForSlot('RESEARCH_API_KEY_ENRICH', slot),
		)
		const client = yield* HttpClient.HttpClient
		const harden = hardenHttp('fullenrich')

		return EnrichmentProvider.of({
			findPeople: (input: EnrichmentInput) =>
				harden(
					Effect.gen(function* () {
						const request = HttpClientRequest.post(PEOPLE_SEARCH_URL).pipe(
							HttpClientRequest.setHeaders({
								Authorization: `Bearer ${Redacted.value(apiKey)}`,
								Accept: 'application/json',
							}),
							HttpClientRequest.bodyJsonUnsafe({
								current_company_domains: [
									{ value: input.domain, exact_match: true },
								],
								current_position_seniority_level:
									DECISION_MAKER_SENIORITIES.map(value => ({ value })),
								limit: RESULT_LIMIT,
							}),
						)
						const response = yield* client.execute(request).pipe(
							Effect.mapError(
								e =>
									new ProviderError({
										provider: 'fullenrich',
										message: String(e),
										recoverable: true,
									}),
							),
						)
						if (response.status < 200 || response.status >= 300) {
							return yield* Effect.fail(
								new ProviderError({
									provider: 'fullenrich',
									message: `people search failed: HTTP ${response.status}`,
									recoverable: statusRecoverable(response.status),
								}),
							)
						}
						const body = yield* HttpClientResponse.schemaBodyJson(
							PeopleSearchResponse,
						)(response).pipe(
							Effect.mapError(
								e =>
									new ProviderError({
										provider: 'fullenrich',
										message: `unexpected people search response: ${e}`,
										recoverable: false,
									}),
							),
						)
						const people = (body.people ?? []).map(person => {
							const current = person.employment?.current
							const emailEntry =
								person.most_probable_work_email ??
								person.contact_info?.work_emails?.[0] ??
								person.most_probable_personal_email ??
								person.contact_info?.personal_emails?.[0]
							return {
								firstName: person.first_name ?? '',
								lastName:
									person.last_name && person.last_name !== HIDDEN_LAST_NAME
										? person.last_name
										: '',
								position: current?.title ?? undefined,
								seniority: current?.seniority ?? undefined,
								email: emailEntry?.email ?? undefined,
								verification: fullEnrichStatusToVerdict(emailEntry?.status),
								linkedin:
									person.social_profiles?.professional_network?.url ??
									undefined,
							}
						})
						return new EnrichmentResult({ people, units: people.length })
					}),
				),
		})
	})
