import { Cause, Effect } from 'effect'
import {
	HttpMiddleware,
	HttpRouter,
	HttpServerRequest,
} from 'effect/unstable/http'

import { boundedCause, makeWorkRecord, WorkRecord } from '@batuda/observability'

// Collapse record-identifying URL segments so errors group by route, not by
// individual record. UUIDs → :id; the query string and fragment are dropped so
// a token in `?code=…`/`?token=…` never lands in a span attribute or log line.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/**
 * A request that says nothing beyond "the poller is still polling".
 *
 * The uptime checker hits `/health` constantly, and a browser asks permission
 * before a cross-origin call — so between them they can outnumber the requests
 * a person actually made. Tracing already spares `/health` for exactly this
 * reason; the record it leaves deserves the same treatment, or the thing that
 * says least fills the most space.
 *
 * Only when it went fine. A health check that fails, or a permission request
 * that is refused, is the moment both exist for, so those stay at their usual
 * level and a failure is never quieted.
 */
const isRoutinePoll = (
	method: string,
	pathPattern: string,
	status: number,
): boolean =>
	status < 400 && (pathPattern === '/health' || method === 'OPTIONS')

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
 * It also opens the request's work record, so anything the request learns on the
 * way — how the caller signed in, which org it resolved to — can be written with
 * `recordFacts` and comes back out on that one completion line. Facts gathered
 * that way sit on the SAME line as the status and the time taken, which is what
 * makes "how long did it take, split by how they signed in" answerable at all.
 *
 * It REPLACES Effect's built-in request logger, which is disabled at `serve`
 * (`disableLogger: true`): that logger annotates `http.url` with the RAW request
 * URL, so a magic-link/reset token in the URL would export verbatim to OTLP.
 * This one logs the sanitized `http.path_pattern` instead.
 *
 * `OrgMiddleware` runs after this one and adds `org.id` to the same request
 * span once the org resolves.
 */
/**
 * The middleware's whole behaviour, as a function of the app it wraps, so a test
 * can drive it with a stub request and read the line it produces. Registering it
 * as router middleware is all `ObservabilityLive` adds.
 */
export const withRequestRecord = <A extends { readonly status: number }, E, R>(
	app: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | HttpServerRequest.HttpServerRequest> =>
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
		const record = yield* makeWorkRecord

		return yield* app.pipe(
			// One completion log per request (replacing the disabled built-in one),
			// at error level for a 5xx so it surfaces, info otherwise. The route is
			// the sanitized path_pattern from `context` below — never the raw URL.
			// Everything the request recorded on the way rides out on this same
			// line, so one row holds the whole story of the request.
			Effect.tap(response =>
				Effect.flatMap(record.read, facts => {
					const failed = response.status >= 500
					return (
						failed
							? Effect.logError('HTTP server error response')
							: isRoutinePoll(request.method, pathPattern, response.status)
								? Effect.logDebug('HTTP request completed')
								: Effect.logInfo('HTTP request completed')
					).pipe(
						Effect.annotateLogs({
							...facts,
							event: failed ? 'http.server_error' : 'http.request',
							'http.status': response.status,
							// Last, so a recorded fact can never shadow the fields that
							// say WHICH request this line belongs to — a wrong request id
							// or route silently breaks tying a request's lines together.
							...context,
						}),
					)
				}),
			),
			// Defects (and any failure cause reaching here) carry the real stack;
			// log the whole cause so it is queryable instead of dying in the
			// console ring-buffer. A pure interrupt is a client disconnect or
			// shutdown, NOT an error — skip it so it doesn't trip error alerts.
			Effect.tapCause(cause =>
				Cause.hasInterruptsOnly(cause)
					? Effect.void
					: Effect.flatMap(record.read, facts =>
							Effect.logError(boundedCause(cause)).pipe(
								Effect.annotateLogs({
									...facts,
									// A defect never becomes a response, so the completion log
									// above never runs and THIS is the only line the request
									// leaves. Name it so a request that failed this hard is
									// still findable by event, like every other one.
									event: 'http.defect',
									...context,
								}),
							),
						),
			),
			// Inside the request, so `recordFacts` anywhere below finds this
			// request's record. Work forked off the request outlives this scope
			// and keeps its own story; it needs a record of its own, not this one.
			Effect.provideService(WorkRecord, record),
			Effect.annotateLogs(context),
		)
	})

export const ObservabilityLive = HttpRouter.middleware(
	HttpMiddleware.make(withRequestRecord),
	{ global: true },
)
