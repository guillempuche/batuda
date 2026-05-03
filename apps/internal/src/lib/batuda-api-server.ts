import { Effect } from 'effect'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest'
import * as HttpApiClient from 'effect/unstable/httpapi/HttpApiClient'

import { BatudaApi } from '@batuda/controllers'

import { apiBaseUrl } from './api-base'

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
