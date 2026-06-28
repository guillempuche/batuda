/**
 * Hunter.io email verifier — deliverability of a single address via the Email
 * Verifier API (api.hunter.io/v2/email-verifier). Maps Hunter's result + an
 * accept-all flag onto the pipeline's `VerificationVerdict`.
 *
 * @see https://hunter.io/api-documentation/v2#email-verifier
 */

import { Effect, Schema } from 'effect'

import { EmailVerifier, type EmailVerifyInput } from '../../application/ports'
import { EmailVerification, type VerificationVerdict } from '../../domain/types'
import {
	HunterNullableBoolean,
	HunterNullableNumber,
	HunterNullableString,
	makeHunterClient,
} from './_client'

const VerifierResponse = Schema.Struct({
	data: Schema.Struct({
		result: HunterNullableString,
		status: HunterNullableString,
		score: HunterNullableNumber,
		accept_all: HunterNullableBoolean,
		mx_records: HunterNullableBoolean,
	}),
})

// An accept-all domain answers 250 to every recipient, so even a "deliverable"
// result is unprovable — collapse it to catch_all, which the send path treats
// as risky.
export const toVerdict = (
	result: string | null | undefined,
	acceptAll: boolean,
): VerificationVerdict => {
	if (acceptAll) return 'catch_all'
	switch (result) {
		case 'deliverable':
			return 'deliverable'
		case 'undeliverable':
			return 'undeliverable'
		case 'risky':
			return 'risky'
		default:
			return 'unknown'
	}
}

export const makeHunterVerifier = (slot: number) =>
	Effect.gen(function* () {
		const { harden, getJson } = yield* makeHunterClient(
			'RESEARCH_API_KEY_VERIFY',
			slot,
		)

		return EmailVerifier.of({
			verify: (input: EmailVerifyInput) =>
				harden(
					Effect.gen(function* () {
						const body = yield* getJson(
							'email-verifier',
							`email=${encodeURIComponent(input.email)}`,
							VerifierResponse,
						)
						const acceptAll = body.data.accept_all ?? false
						return new EmailVerification({
							result: toVerdict(body.data.result, acceptAll),
							score: body.data.score ?? undefined,
							catchAll: acceptAll,
							mxFound: body.data.mx_records ?? false,
							units: 1,
						})
					}),
				),
		})
	})
