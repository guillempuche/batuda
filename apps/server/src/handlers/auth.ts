import { Readable } from 'node:stream'

import { NodeHttpServerRequest } from '@effect/platform-node'
import { fromNodeHeaders } from 'better-auth/node'
import { Effect, Layer } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi } from '@batuda/controllers'

import { Auth } from '../lib/auth'
import { EnvVars } from '../lib/env'

const proxyToAuth = Effect.gen(function* () {
	const { instance } = yield* Auth
	const env = yield* EnvVars
	const req = yield* HttpServerRequest.HttpServerRequest
	const incomingMessage = NodeHttpServerRequest.toIncomingMessage(req)
	const base = env.BETTER_AUTH_BASE_URL || `https://api.batuda.co`

	const headers = fromNodeHeaders(incomingMessage.headers)
	const url = new URL(req.url, base)
	const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
	const init: RequestInit = { method: req.method, headers }
	if (hasBody) {
		init.body = Readable.toWeb(incomingMessage) as ReadableStream
		// Node requires duplex for streaming request bodies
		// biome-ignore lint/complexity/useLiteralKeys: duplex must be set dynamically
		;(init as Record<string, unknown>)['duplex'] = 'half'
	}
	const fetchRequest = new Request(url, init)

	const response = yield* Effect.promise(() => instance.handler(fetchRequest))

	// The MCP OAuth-drop bug shows up as failures on the token endpoint, which
	// Better Auth serves opaquely. Tag the request span with the grant outcome
	// (response status) so a refresh failure is visible in Honeycomb without a
	// console grep. The request body is already streamed to Better Auth, so
	// grant_type isn't read here (would need teeing the stream).
	if (url.pathname.endsWith('/oauth2/token')) {
		yield* Effect.annotateCurrentSpan({
			'auth.endpoint': 'oauth2/token',
			'auth.token_response_status': response.status,
		})
	}

	return HttpServerResponse.fromWeb(response)
})

export const AuthHandlerLive = HttpApiBuilder.group(
	BatudaApi,
	'auth',
	handlers =>
		Effect.succeed(
			handlers
				.handle('authGet', () => proxyToAuth)
				.handle('authPost', () => proxyToAuth),
		),
).pipe(Layer.provide([Auth.layer, EnvVars.layer]))
