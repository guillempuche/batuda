import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { admin, bearer, openAPI } from 'better-auth/plugins'
import { Effect, Layer, Redacted, ServiceMap } from 'effect'
import { PostgresDialect } from 'kysely'
import pg from 'pg'

import { EnvVars } from './env'

export class Auth extends ServiceMap.Service<Auth>()('Auth', {
	make: Effect.gen(function* () {
		const env = yield* EnvVars

		const pool = new pg.Pool({
			connectionString: Redacted.value(env.DATABASE_URL),
		})

		const instance = betterAuth({
			basePath: '/auth',
			baseURL: env.BETTER_AUTH_BASE_URL,
			secret: Redacted.value(env.BETTER_AUTH_SECRET),
			database: {
				dialect: new PostgresDialect({ pool }),
				type: 'postgres',
			},
			// Sign-up is invite-only: the public `/auth/sign-up/email` endpoint
			// is disabled (Better-Auth returns 400 `Email and password sign up
			// is not enabled` — see `sign-up.ts:181-187` in the vendored
			// source). New users must be created programmatically via the
			// admin plugin (`auth.api.createUser`) by an already-authenticated
			// admin or by a trusted server caller using an API key. See
			// `docs/backend.md#authentication-better-auth` for the invite
			// flow and `apps/cli/src/commands/seed.ts` for a working example.
			emailAndPassword: { enabled: true, disableSignUp: true },
			user: {
				additionalFields: {
					isAgent: {
						type: 'boolean',
						required: false,
						defaultValue: false,
					},
				},
			},
			session: {
				expiresIn: 60 * 60 * 24 * 30, // 30 days
				updateAge: 60 * 60 * 24 * 7, // renew weekly
			},
			plugins: [
				openAPI(),
				bearer(),
				admin(),
				apiKey({ enableSessionForAPIKeys: true }),
			],
			rateLimit: {
				enabled: true,
				storage: 'memory',
				window: 60,
				max: 100,
			},
			advanced: {
				cookiePrefix: 'forja',
				useSecureCookies: !env.BETTER_AUTH_INSECURE_COOKIES,
			},
			trustedOrigins: env.ALLOWED_ORIGINS,
		})

		return { instance } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(EnvVars.layer),
	)
}
