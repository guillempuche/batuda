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
	let apiHost: string
	try {
		apiHost = new URL(portlessUrl).hostname
	} catch {
		return null
	}
	if (!apiHost.endsWith(DEV_MARKER)) return null
	// `<branch>.api.batuda.localhost` → `<branch>.batuda.localhost` (and the main
	// checkout's `api.batuda.localhost` → `batuda.localhost`).
	const appHost = apiHost.replace(`api.${DEV_MARKER}`, DEV_MARKER)
	// portless serves these dev hosts over HTTPS but reports PORTLESS_URL as
	// `http://…:443`; the browser origin that CORS + cookies must match is always
	// https, so pin the scheme (and drop the port by using the hostname).
	return {
		apiOrigin: `https://${apiHost}`,
		appOrigin: `https://${appHost}`,
	}
}
