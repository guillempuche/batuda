import { Layer } from 'effect'
import { HttpMiddleware } from 'effect/http'

// Routes where tracing is suppressed. The tracer records `url.full`/`url.query`
// UNREDACTED, so any route whose URL itself carries a secret must be exempt or
// the token lands in Honeycomb: magic-link verify (token in query) and
// reset-password (token in path). `/health` is exempt too — the uptime checker
// polls it constantly and would otherwise drown the real traces. Matched on the
// path alone so a query string (e.g. `/health?x=1`) doesn't slip through.
const TracerExemptionsLive = Layer.succeed(HttpMiddleware.TracerDisabledWhen)(
	request => {
		const path = request.url.split('?')[0] ?? request.url
		return path === '/health' || carriesToken(path)
	},
)

const TOKEN_ROUTES = ['/magic-link/verify', '/reset-password']

// Read loosely — decoded, in upper or lower case, backslashes taken as slashes,
// anywhere in the path — so a spelling the server still answers
// (`/auth//reset-password/…`, `/auth/%72eset-password/…`) is exempt too. A trace
// left out costs nothing; a token recorded is the leak.
const carriesToken = (path: string): boolean => {
	const loose = loosePath(path)
	return TOKEN_ROUTES.some(route => loose.includes(route))
}

/**
 * A request path as loosely as a server might read it: percent-decoded, lower
 * case, backslashes as slashes. Matching a token route against this catches the
 * odd spellings that still reach it, where an exact match would let the token
 * through.
 */
export const loosePath = (path: string): string => {
	let decoded = path
	try {
		decoded = decodeURIComponent(path)
	} catch {
		// Not valid percent-encoding: read it as it was sent.
	}
	return decoded.toLowerCase().replaceAll('\\', '/')
}

/**
 * Applies the routes exempt from tracing to a served app.
 *
 * They have to wrap what `HttpRouter.serve` returns. The server builds the app
 * on its own, so exemptions handed to the app inside it never reach the span the
 * server opens for each request — every exempt route is then traced, its token
 * included.
 */
export const withTracerExemptions = <A, E, R>(served: Layer.Layer<A, E, R>) =>
	served.pipe(Layer.provide(TracerExemptionsLive))
