import { Effect, Layer } from 'effect'
import { HttpMiddleware, HttpRouter } from 'effect/unstable/http'

import { EnvVars } from './env'

/**
 * Origin matching for ALLOWED_ORIGINS. Each pattern is either a literal
 * origin (`https://host` / `https://host:port`) matched exactly, or a
 * wildcard-subdomain pattern (`https://*.host`) that matches any single
 * additional subdomain segment under `host`.
 *
 * Wildcards are scoped to subdomains only — the protocol and the suffix
 * after `*.` must match literally — so `https://*.batuda.localhost`
 * accepts `https://worktree-foo.batuda.localhost` but never
 * `https://attacker.com` or `https://evil.batuda.localhost.attacker.com`.
 * Listing every allowed origin explicitly is still preferred in
 * production; the wildcard exists so dev worktrees (e.g. portless
 * branch-prefixed routes) don't need a fresh ALLOWED_ORIGINS entry per
 * branch.
 */
export const matchOrigin = (
	origin: string | undefined,
	pattern: string,
): boolean => {
	// Same-origin requests don't carry an Origin header so the CORS
	// middleware passes `undefined` here. Treat that as no-match — the
	// browser only enforces CORS on cross-origin requests anyway.
	if (typeof origin !== 'string') return false
	if (origin === pattern) return true
	const wildcardPrefix = '://*.'
	const wildcardAt = pattern.indexOf(wildcardPrefix)
	if (wildcardAt === -1) return false
	const protocol = pattern.slice(0, wildcardAt + 3) // includes "://"
	const suffix = pattern.slice(wildcardAt + wildcardPrefix.length) // host after "*."
	if (!origin.startsWith(protocol)) return false
	const host = origin.slice(protocol.length)
	if (!host.endsWith(`.${suffix}`)) return false
	const sub = host.slice(0, host.length - suffix.length - 1)
	if (sub.length === 0) return false
	if (sub.includes('/')) return false
	// Wildcard matches a single label so `a.b.host` doesn't accidentally
	// satisfy `*.host`. Multi-segment wildcards would need their own pattern.
	return !sub.includes('.')
}

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
				exposedHeaders: ['content-length', 'content-type'],
				maxAge: 86400, // 24 h — preflight cache; browsers cap at this anyway.
			}),
			{ global: true },
		)
	}),
)
