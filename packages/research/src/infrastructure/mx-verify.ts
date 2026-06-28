/**
 * MX-record pre-gate for contact discovery. A free `dns.resolveMx` check that
 * short-circuits the paid email verifier: a domain with no mail exchanger can't
 * receive mail at all, while a transient DNS error stays inconclusive and falls
 * through to the verifier rather than failing a good address closed.
 */

import { promises as dns } from 'node:dns'

import { Effect, Layer } from 'effect'

import { type MxOutcome, MxResolver } from '../application/ports'

// `ENOTFOUND` (no such host) and `ENODATA` (host exists, no MX) both mean the
// domain cannot receive mail. Any other failure is inconclusive.
const isNoRecords = (error: unknown): boolean => {
	const code = (error as { code?: unknown }).code
	return code === 'ENOTFOUND' || code === 'ENODATA'
}

/** Resolve a domain's MX state. Never fails — an error becomes `unknown`. */
export const resolveMxOutcome = (domain: string): Effect.Effect<MxOutcome> =>
	Effect.tryPromise({
		try: () => dns.resolveMx(domain),
		catch: error => error,
	}).pipe(
		Effect.timeout('2 seconds'),
		Effect.match({
			onSuccess: records =>
				records.length > 0 ? ('has_mx' as const) : ('no_mx' as const),
			onFailure: error =>
				isNoRecords(error) ? ('no_mx' as const) : ('unknown' as const),
		}),
	)

export const MxResolverLive = Layer.succeed(MxResolver)({
	resolve: resolveMxOutcome,
})
