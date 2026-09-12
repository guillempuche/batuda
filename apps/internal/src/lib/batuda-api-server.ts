import { Effect } from 'effect'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest'
import * as HttpApiClient from 'effect/unstable/httpapi/HttpApiClient'

import { BatudaApi } from '@batuda/controllers'

import { apiBaseUrl } from './api-base'
import { getServerCookieHeader } from './server-cookie'

/**
 * Server-side Batuda API client used by route loaders during SSR.
 *
 * Builds a typed `HttpApiClient.make(BatudaApi, ...)` instance that
 * forwards the provided cookie header on every request via
 * `transformClient` (`HttpApiClient.ts:378`). Called once per SSR
 * request with the incoming cookie string — different visitor, different
 * client — so the session is request-scoped.
 *
 * Why not `FetchHttpClient.RequestInit` like the browser client: that
 * service is process-global; cookies are request-scoped. `transformClient`
 * is the supported hook for per-client request shaping.
 */
export const makeBatudaApiServer = (cookieHeader: string | undefined) =>
	HttpApiClient.make(BatudaApi, {
		baseUrl: apiBaseUrl(),
		transformClient: httpClient =>
			cookieHeader
				? HttpClient.mapRequest(
						httpClient,
						HttpClientRequest.setHeader('cookie', cookieHeader),
					)
				: httpClient,
	}).pipe(Effect.provide(FetchHttpClient.layer))

/** The typed client a loader's program receives. */
export type BatudaApiServerClient = Effect.Success<
	ReturnType<typeof makeBatudaApiServer>
>

/**
 * Runs one program against the API as the visitor whose page is being
 * rendered: reads the request's cookie, builds the client for it, runs the
 * program and settles it to a promise. Every route loader that fetches ahead
 * of the page goes through here, so how the visitor is identified is decided
 * once. Reach it through `import('#/lib/batuda-api-server')` from a loader,
 * so the server client stays out of the browser bundle.
 */
export async function withServerApi<A, E>(
	program: (client: BatudaApiServerClient) => Effect.Effect<A, E>,
): Promise<A> {
	const cookie = await getServerCookieHeader()
	return Effect.runPromise(
		clientFor(cookie ?? undefined).pipe(Effect.flatMap(program)),
	)
}

// One page render runs several loaders for the same visitor, and building the
// client means walking every endpoint of the API. Built once per cookie and
// kept for a short while, so the loaders of one request share it; the cap
// keeps a burst of different visitors from growing the map without bound.
const CLIENT_CACHE_LIMIT = 32
const clients = new Map<string, BatudaApiServerClient>()

function clientFor(cookie: string | undefined) {
	const key = cookie ?? ''
	const cached = clients.get(key)
	if (cached) return Effect.succeed(cached)
	return makeBatudaApiServer(cookie).pipe(
		Effect.tap(client =>
			Effect.sync(() => {
				if (clients.size >= CLIENT_CACHE_LIMIT) {
					const oldest = clients.keys().next().value
					if (oldest !== undefined) clients.delete(oldest)
				}
				clients.set(key, client)
			}),
		),
	)
}
