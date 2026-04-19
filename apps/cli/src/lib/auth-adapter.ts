import { Config, Effect, Redacted } from 'effect'

import {
	acquirePgPool,
	type MagicLinkCallback,
	makeBetterAuthAdapter,
} from '@batuda/auth'

export const acquireAuthAdapter = (opts?: {
	readonly baseURL?: string
	readonly magicLinkSender?: MagicLinkCallback
}) =>
	Effect.gen(function* () {
		const dbUrl = yield* Config.redacted('DATABASE_URL')
		const secret = yield* Config.string('BETTER_AUTH_SECRET')
		const baseURL =
			opts?.baseURL ??
			(yield* Config.string('BETTER_AUTH_BASE_URL').pipe(
				Config.withDefault('http://localhost:3010'),
			))
		const pool = yield* acquirePgPool(Redacted.value(dbUrl))
		return makeBetterAuthAdapter({
			env: {
				secret,
				baseURL,
				useSecureCookies: false,
				trustedOrigins: [],
			},
			pool,
			...(opts?.magicLinkSender
				? { magicLinkSender: opts.magicLinkSender }
				: {}),
		})
	})
