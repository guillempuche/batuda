import { NodeHttpServerRequest } from '@effect/platform-node'
import { fromNodeHeaders } from 'better-auth/node'
import { Effect, Layer } from 'effect'
import { HttpServerRequest } from 'effect/unstable/http'

import {
	SessionContext,
	SessionMiddleware,
	Unauthorized,
} from '@engranatge/controllers'

import { Auth } from '../lib/auth'

/**
 * Implementing Layer for the `SessionMiddleware` Tag declared in
 * `@engranatge/controllers`. Lives here (not in the shared package)
 * because it depends on Better-Auth and Node HTTP — pulling those into
 * `packages/controllers` would make the spec package browser-hostile and
 * defeat the point of sharing the same HttpApi with the frontend client.
 */
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
