import { Cause, Effect } from 'effect'
import {
	HttpMiddleware,
	HttpRouter,
	HttpServerRequest,
} from 'effect/unstable/http'

// Collapse record-identifying URL segments so errors group by route, not by
// individual record. UUIDs → :id; the query string and fragment are dropped so
// a token in `?code=…`/`?token=…` never lands in a span attribute or log line.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

export const httpPathPattern = (url: string): string => {
	const path = url.split('?')[0]?.split('#')[0] ?? url
	// The reset-password token rides in the path itself (not a UUID), so collapse
	// that whole segment — otherwise it would leak into the log line.
	if (path.startsWith('/auth/reset-password/'))
		return '/auth/reset-password/:token'
	return path.replace(UUID, ':id')
}

/**
 * Catch-all observability middleware. Annotates every request's span and logs
 * with a stable id + route, emits one sanitized per-request completion log, and
 * guarantees the full cause of any defect or 5xx is logged at error level — the
 * last line of defence so no API error escapes unlogged (and therefore
 * unexported once OTLP is on). Attached globally like `CorsLive`.
 *
 * It REPLACES Effect's built-in request logger, which is disabled at `serve`
 * (`disableLogger: true`): that logger annotates `http.url` with the RAW request
 * URL, so a magic-link/reset token in the URL would export verbatim to OTLP.
 * This one logs the sanitized `http.path_pattern` instead.
 *
 * `OrgMiddleware` runs after this one and adds `org.id` to the same request
 * span once the org resolves.
 */
export const ObservabilityLive = HttpRouter.middleware(
	HttpMiddleware.make(app =>
		Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest
			// Reuse an upstream correlation id when the edge supplies one, else mint
			// one so a single request's logs and span share a key.
			const requestId = request.headers['x-request-id'] ?? crypto.randomUUID()
			const pathPattern = httpPathPattern(request.url)
			const context = {
				'request.id': requestId,
				'http.method': request.method,
				'http.path_pattern': pathPattern,
			}

			yield* Effect.annotateCurrentSpan(context)

			return yield* app.pipe(
				// One completion log per request (replacing the disabled built-in one),
				// at error level for a 5xx so it surfaces, info otherwise. The route is
				// the sanitized path_pattern from `context` below — never the raw URL.
				Effect.tap(response =>
					response.status >= 500
						? Effect.logError('HTTP server error response').pipe(
								Effect.annotateLogs({
									event: 'http.server_error',
									'http.status': response.status,
								}),
							)
						: Effect.logInfo('HTTP request completed').pipe(
								Effect.annotateLogs({
									event: 'http.request',
									'http.status': response.status,
								}),
							),
				),
				// Defects (and any failure cause reaching here) carry the real stack;
				// log the whole cause so it is queryable instead of dying in the
				// console ring-buffer. A pure interrupt is a client disconnect or
				// shutdown, NOT an error — skip it so it doesn't trip error alerts.
				Effect.tapCause(cause =>
					Cause.hasInterruptsOnly(cause)
						? Effect.void
						: Effect.logError(Cause.pretty(cause)),
				),
				Effect.annotateLogs(context),
			)
		}),
	),
	{ global: true },
)
