import { Config, Effect, Layer } from 'effect'
import { HttpMiddleware, HttpRouter } from 'effect/unstable/http'

/**
 * Exact URL origin matching — no regex, no wildcards. ALLOWED_ORIGINS is a
 * comma-separated list of full origins (`https://host` or `https://host:port`)
 * and each candidate origin must match one of them literally. Listing every
 * allowed origin explicitly avoids accidental overmatch from wildcard patterns.
 */
export const matchOrigin = (origin: string, pattern: string): boolean =>
	origin === pattern

export const CorsLive = Layer.unwrap(
	Effect.gen(function* () {
		// Required — no fallback. Crashes on boot if unset so production never
		// silently runs with wrong origins. Comma-separated list of exact
		// cross-origin callers (e.g. `https://batuda.localhost`). The API does
		// not list its own host — same-origin requests skip CORS. Must agree
		// with Better-Auth `trustedOrigins` in lib/auth.ts.
		const allowedOrigins = yield* Config.string('ALLOWED_ORIGINS').pipe(
			Config.map(s => s.split(',').map(o => o.trim())),
		)

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
				exposedHeaders: ['content-length', 'content-type'],
				maxAge: 86400, // 24 h — preflight cache; browsers cap at this anyway.
			}),
			{ global: true },
		)
	}),
)
