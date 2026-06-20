// The dev hostname marker portless prefixes the git branch onto. Off this marker
// (e.g. production hosts) there is no worktree to derive, so callers fall back to
// the static env values.
const DEV_MARKER = 'batuda.localhost'

/**
 * Derive a worktree's own origins from the PORTLESS_URL portless injects into the
 * server process. The server runs at `<branch>.api.batuda.localhost`, paired with
 * an app at `<branch>.batuda.localhost`. Returns null when PORTLESS_URL is absent
 * or not a `*.batuda.localhost` host, so production keeps its configured origins.
 *
 * This is the inverse of the web's derivation in apps/internal/vite.config.ts,
 * which inserts `api.` before the marker to point the app at its server.
 */
export const deriveWorktreeOrigins = (
	portlessUrl: string | undefined,
): { apiOrigin: string; appOrigin: string } | null => {
	if (!portlessUrl) return null
	let url: URL
	try {
		url = new URL(portlessUrl)
	} catch {
		return null
	}
	const apiHost = url.hostname
	// Match on a label boundary, not a bare suffix: a lookalike host like
	// `xbatuda.localhost` must not slip through and self-derive a trusted origin.
	if (apiHost !== DEV_MARKER && !apiHost.endsWith(`.${DEV_MARKER}`)) return null
	// `<branch>.api.batuda.localhost` → `<branch>.batuda.localhost` (and the main
	// checkout's `api.batuda.localhost` → `batuda.localhost`).
	const appHost = apiHost.replace(`api.${DEV_MARKER}`, DEV_MARKER)
	// portless fronts these dev hosts with HTTPS, so pin the scheme whatever
	// PORTLESS_URL reports. Keep the port portless actually bound: it falls back
	// to a non-privileged port (e.g. :1355) when it can't bind 443, and the
	// browser's Origin header carries that port — so the derived origin must too,
	// or CORS + Better-Auth reject the sign-in. The default :443 is dropped
	// because the browser omits it from the Origin.
	const portSuffix = url.port && url.port !== '443' ? `:${url.port}` : ''
	return {
		apiOrigin: `https://${apiHost}${portSuffix}`,
		appOrigin: `https://${appHost}${portSuffix}`,
	}
}
