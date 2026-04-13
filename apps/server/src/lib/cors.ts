import { Config, Effect, Layer } from 'effect'
import { HttpMiddleware, HttpRouter } from 'effect/unstable/http'

/**
 * URL-based origin matching (never regex) to avoid ReDoS and escaping bugs.
 * Wildcards only match the `https://*.suffix` form — the origin is parsed
 * with the `URL` constructor, then the hostname is compared via suffix check.
 */
export const matchOrigin = (origin: string, pattern: string): boolean => {
	if (!pattern.includes('*')) return origin === pattern

	// Parse origin with URL constructor — rejects malformed values
	let parsed: URL
	try {
		parsed = new URL(origin)
	} catch {
		return false
	}

	// Parse pattern by replacing * with a placeholder so it's a valid URL
	let patternParsed: URL
	try {
		patternParsed = new URL(pattern.replace('*', '_wildcard_'))
	} catch {
		return false
	}

	// Protocol must match exactly (https vs http)
	if (parsed.protocol !== patternParsed.protocol) return false

	// Port must match ('' = default port for the protocol)
	if (parsed.port !== patternParsed.port) return false

	// Hostname suffix check: "_wildcard_.engranatge.localhost" → ".engranatge.localhost"
	const suffix = patternParsed.hostname.replace('_wildcard_', '')
	if (!suffix.startsWith('.')) return false
	if (!parsed.hostname.endsWith(suffix)) return false

	// Must have at least one character before the suffix (bare domain != wildcard match)
	const prefix = parsed.hostname.slice(0, -suffix.length)
	return prefix.length > 0
}

export const CorsLive = Layer.unwrap(
	Effect.gen(function* () {
		// Required — no fallback. Crashes on boot if unset so production never
		// silently runs with wrong origins. Comma-separated, supports wildcards
		// (e.g. `https://*.engranatge.localhost`). Must agree with Better-Auth
		// `trustedOrigins` in lib/auth.ts.
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
