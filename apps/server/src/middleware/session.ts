import { NodeHttpServerRequest } from '@effect/platform-node'
import { fromNodeHeaders } from 'better-auth/node'
import { Effect, Layer, ServiceMap } from 'effect'
import { HttpServerRequest } from 'effect/unstable/http'
import { HttpApiMiddleware, HttpApiSchema } from 'effect/unstable/httpapi'

import { Unauthorized } from '../errors'
import { Auth } from '../lib/auth'

export class SessionContext extends ServiceMap.Service<
	SessionContext,
	{
		readonly userId: string
		readonly email: string
		readonly name: string | undefined
		readonly isAgent: boolean
	}
>()('SessionContext') {}

export class SessionMiddleware extends HttpApiMiddleware.Service<
	SessionMiddleware,
	{ provides: SessionContext }
>()('SessionMiddleware', {
	error: Unauthorized.pipe(HttpApiSchema.status(401)),
}) {}

export const SessionMiddlewareLive = Layer.effect(
	SessionMiddleware,
	Effect.gen(function* () {
		const { instance } = yield* Auth

		return effect =>
			Effect.gen(function* () {
				const req = yield* HttpServerRequest.HttpServerRequest
				const incomingMessage = NodeHttpServerRequest.toIncomingMessage(req)
				const headers = fromNodeHeaders(incomingMessage.headers)

				const result = yield* Effect.promise(() =>
					instance.api.getSession({ headers }),
				)

				if (!result) {
					return yield* new Unauthorized({
						message: 'Invalid or missing session',
					})
				}

				const { user } = result

				return yield* Effect.provideService(effect, SessionContext, {
					userId: user.id,
					email: user.email,
					name: user.name,
					isAgent: user.isAgent === true,
				})
			})
	}),
).pipe(Layer.provide(Auth.layer))
