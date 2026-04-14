import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { admin, bearer, magicLink, openAPI } from 'better-auth/plugins'
import { Effect, Layer, Redacted, ServiceMap } from 'effect'
import pg from 'pg'

import { buildBetterAuthConfig } from '@engranatge/auth'

import { EmailProvider } from '../services/email-provider'
import { EmailProviderLive } from '../services/email-provider-live'
import { EnvVars } from './env'

export class Auth extends ServiceMap.Service<Auth>()('Auth', {
	make: Effect.gen(function* () {
		const env = yield* EnvVars
		const emailProvider = yield* EmailProvider

		const pool = new pg.Pool({
			connectionString: Redacted.value(env.DATABASE_URL),
		})

		// The shared builder is the single source of truth for Engranatge's
		// Better-Auth config. CLI commands use the same builder with a
		// narrower plugin list (no magicLink) so that API keys and sessions
		// created out-of-band validate against the running server here.
		// Sign-up is invite-only: `emailAndPassword.disableSignUp` closes the
		// public `/auth/sign-up/email` endpoint. New users are created via
		// `auth.api.createUser` (admin plugin escape hatch) — see
		// `pnpm cli auth bootstrap` for the production path.
		const instance = betterAuth(
			buildBetterAuthConfig({
				env: {
					secret: Redacted.value(env.BETTER_AUTH_SECRET),
					baseURL: env.BETTER_AUTH_BASE_URL,
					useSecureCookies: !env.BETTER_AUTH_INSECURE_COOKIES,
					trustedOrigins: env.ALLOWED_ORIGINS,
				},
				pool,
				plugins: [
					openAPI(),
					bearer(),
					admin(),
					apiKey({ enableSessionForAPIKeys: true }),
					magicLink({
						sendMagicLink: data =>
							Effect.runPromise(
								emailProvider.sendMagicLink({
									email: data.email,
									url: data.url,
									token: data.token,
								}),
							),
					}),
				],
			}),
		)

		return { instance } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(EnvVars.layer),
		Layer.provide(EmailProviderLive),
	)
}
