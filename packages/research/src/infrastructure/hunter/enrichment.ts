/**
 * Hunter.io enrichment provider — decision-maker discovery via Domain Search
 * (api.hunter.io/v2/domain-search). Returns the people Hunter knows for a
 * company domain, with email, confidence, and seniority/department that the
 * pipeline uses to rank decision-makers.
 *
 * @see https://hunter.io/api-documentation/v2#domain-search
 */

import { Effect, Schema } from 'effect'

import {
	type EnrichmentInput,
	EnrichmentProvider,
} from '../../application/ports'
import { EnrichmentResult } from '../../domain/types'
import {
	HunterNullableNumber,
	HunterNullableString,
	hunterStatusToVerdict,
	makeHunterClient,
} from './_client'

const HunterEmail = Schema.Struct({
	value: HunterNullableString,
	type: HunterNullableString,
	confidence: HunterNullableNumber,
	first_name: HunterNullableString,
	last_name: HunterNullableString,
	position: HunterNullableString,
	seniority: HunterNullableString,
	department: HunterNullableString,
	linkedin: HunterNullableString,
	twitter: HunterNullableString,
	phone_number: HunterNullableString,
	verification: Schema.optional(
		Schema.NullOr(Schema.Struct({ status: HunterNullableString })),
	),
})

const DomainSearchResponse = Schema.Struct({
	data: Schema.Struct({
		pattern: HunterNullableString,
		emails: Schema.optional(Schema.Array(HunterEmail)),
	}),
})

export const makeHunterEnrichment = (slot: number) =>
	Effect.gen(function* () {
		const { harden, getJson } = yield* makeHunterClient(
			'RESEARCH_API_KEY_ENRICH',
			slot,
		)

		return EnrichmentProvider.of({
			findPeople: (input: EnrichmentInput) =>
				harden(
					Effect.gen(function* () {
						const body = yield* getJson(
							'domain-search',
							`domain=${encodeURIComponent(input.domain)}`,
							DomainSearchResponse,
						)
						const people = (body.data.emails ?? []).map(e => ({
							firstName: e.first_name ?? '',
							lastName: e.last_name ?? '',
							position: e.position ?? undefined,
							seniority: e.seniority ?? undefined,
							department: e.department ?? undefined,
							email: e.value ?? undefined,
							emailConfidence: e.confidence ?? undefined,
							type: e.type ?? undefined,
							verification: hunterStatusToVerdict(e.verification?.status),
							linkedin: e.linkedin ?? undefined,
							// Hunter's field is `twitter`; our channel kind is `x`.
							x: e.twitter ?? undefined,
							phone: e.phone_number ?? undefined,
						}))
						return new EnrichmentResult({ people, units: 1 })
					}),
				),
		})
	})
