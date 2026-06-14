import { Effect, Layer } from 'effect'
import { HttpMiddleware, HttpRouter } from 'effect/unstable/http'

import { EnvVars } from './env'
import { matchOrigin } from './origin-match'

// Re-exported so existing importers (e.g. lib/cors.test.ts) keep their path.
export { matchOrigin }

export const CorsLive = Layer.unwrap(
	Effect.gen(function* () {
		// Reads the already-validated ALLOWED_ORIGINS list from EnvVars so
		// any wildcard-pattern audit (see env.ts) applies here too. Same
		// array is reused as Better-Auth `trustedOrigins` in lib/auth.ts.
		const env = yield* EnvVars
		const allowedOrigins = env.ALLOWED_ORIGINS

		const isAllowedOrigin = (origin: string): boolean =>
			allowedOrigins.some(p => matchOrigin(origin, p))

		yield* Effect.logInfo(`cors allowed origins: ${allowedOrigins.join(', ')}`)
		// allowedHeaders left unset — preflight echoes back whatever the browser
		// asks for (Content-Type, Authorization, x-api-key, etc.) automatically.
		return HttpRouter.middleware(
			HttpMiddleware.cors({
				allowedOrigins: isAllowedOrigin,
				// Required: browser only attaches the session cookie with
				// credentials:'include' + a specific origin (not *).
				credentials: true,
				exposedHeaders: ['content-length', 'content-type', 'retry-after'],
				maxAge: 86400, // 24 h — preflight cache; browsers cap at this anyway.
			}),
			{ global: true },
		)
	}),
)
