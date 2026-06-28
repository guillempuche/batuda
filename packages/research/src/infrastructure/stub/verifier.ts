/**
 * Stub email verifier — deterministic verdicts for zero-cost local dev. Treats
 * anything at a `@catchall.*` domain as catch-all and everything else as
 * deliverable, so tests can exercise both ranking branches without a network.
 */

import { Effect, Layer } from 'effect'

import { EmailVerifier } from '../../application/ports'
import { EmailVerification } from '../../domain/types'

export const StubEmailVerifierInstance = EmailVerifier.of({
	verify: input => {
		const isCatchAll = /@catchall\./i.test(input.email)
		return Effect.succeed(
			new EmailVerification({
				result: isCatchAll ? 'catch_all' : 'deliverable',
				score: isCatchAll ? 50 : 95,
				catchAll: isCatchAll,
				mxFound: true,
				units: 0,
			}),
		)
	},
})

export const StubEmailVerifier = Layer.succeed(EmailVerifier)(
	StubEmailVerifierInstance,
)
