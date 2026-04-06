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
			emailAndPassword: { enabled: true },
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
