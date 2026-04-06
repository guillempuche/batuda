import { NodeHttpServerRequest } from '@effect/platform-node'
import { fromNodeHeaders } from 'better-auth/node'
import { Effect, Layer } from 'effect'
import { McpServer } from 'effect/unstable/ai'
import {
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from 'effect/unstable/http'

import { Auth } from '../lib/auth'
import { CurrentUser } from './current-user'
import { McpToolsLive } from './server'

const McpAuthMiddleware = HttpRouter.middleware(
	Effect.gen(function* () {
		const { instance } = yield* Auth

		return httpEffect =>
			Effect.gen(function* () {
				const req = yield* HttpServerRequest.HttpServerRequest
				if (!req.url.startsWith('/mcp')) {
					return yield* httpEffect
				}

				const incomingMessage = NodeHttpServerRequest.toIncomingMessage(req)
				const headers = fromNodeHeaders(incomingMessage.headers)
				const result = yield* Effect.promise(() =>
					instance.api.getSession({ headers }),
				)

				if (!result) {
					return yield* HttpServerResponse.json(
						{
							jsonrpc: '2.0',
							id: null,
							error: { code: -32001, message: 'Unauthorized' },
						},
						{ status: 401 },
					)
				}

				return yield* Effect.provideService(httpEffect, CurrentUser, {
					userId: result.user.id,
					email: result.user.email,
					name: result.user.name ?? 'Unknown',
					isAgent: result.user.isAgent === true,
				})
			})
	}),
	{ global: true },
)

export const McpHttpLive = Layer.mergeAll(McpToolsLive, McpAuthMiddleware).pipe(
	Layer.provide(
		McpServer.layerHttp({ name: 'forja', version: '1.0.0', path: '/mcp' }),
	),
)
