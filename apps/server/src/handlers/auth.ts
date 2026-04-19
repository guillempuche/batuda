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
