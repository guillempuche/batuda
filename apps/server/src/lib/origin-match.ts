/**
 * Exact-match check for ALLOWED_ORIGINS. Every pattern is a literal origin
 * (`https://host` / `https://host:port`) compared verbatim — there are no
 * wildcard patterns. A dev worktree's branch-prefixed origin is trusted by
 * deriving it from `PORTLESS_URL` and merging it into ALLOWED_ORIGINS (see
 * lib/env.ts), so every trusted origin is listed explicitly rather than via a
 * broad `*.host` subdomain grant.
 *
 * Shared by the CORS middleware (lib/cors.ts) and the APP_PUBLIC_URL boot
 * check (lib/env.ts), so both judge an origin the same way.
 */
export const matchOrigin = (
	origin: string | undefined,
	pattern: string,
): boolean => {
	// Same-origin requests don't carry an Origin header so the CORS
	// middleware passes `undefined` here. Treat that as no-match — the
	// browser only enforces CORS on cross-origin requests anyway.
	if (typeof origin !== 'string') return false
	return origin === pattern
}
