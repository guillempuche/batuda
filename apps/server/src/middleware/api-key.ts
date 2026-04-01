import { createHash } from 'node:crypto'

import { Effect, Layer, Redacted, ServiceMap } from 'effect'
import { HttpApiMiddleware, HttpApiSecurity } from 'effect/unstable/httpapi'
import { SqlClient } from 'effect/unstable/sql'

import { Unauthorized } from '../errors'

export class ApiKeyContext extends ServiceMap.Service<
	ApiKeyContext,
	{ readonly scopes: ReadonlyArray<string>; readonly keyId: string }
>()('ApiKeyContext') {}

export const apiKeySecurity = HttpApiSecurity.apiKey({
	in: 'header',
	key: 'x-api-key',
})

export class ApiKeyMiddleware extends HttpApiMiddleware.Service<
	ApiKeyMiddleware,
	{ provides: ApiKeyContext }
>()('ApiKeyMiddleware', {
	security: { apiKey: apiKeySecurity },
	error: Unauthorized,
}) {}

const hashKey = (key: string): string =>
	createHash('sha256').update(key).digest('hex')

export const ApiKeyMiddlewareLive = Layer.effect(
	ApiKeyMiddleware,
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient

		return {
			apiKey: (
				effect: Effect.Effect<any, any, any>,
				{ credential }: { credential: Redacted.Redacted<string> },
			) =>
				Effect.gen(function* () {
					const raw = Redacted.value(credential)
					const hash = hashKey(raw)

					const rows =
						yield* sql`SELECT * FROM api_keys WHERE key_hash = ${hash} AND is_active = true LIMIT 1`

					const apiKey = rows[0]
					if (!apiKey)
						return yield* new Unauthorized({
							message: 'Invalid API key',
						})

					if (
						apiKey['expiresAt'] &&
						new Date(apiKey['expiresAt'] as string) < new Date()
					)
						return yield* new Unauthorized({
							message: 'API key expired',
						})

					// Fire-and-forget: update last_used_at
					yield* sql`UPDATE api_keys SET last_used_at = now() WHERE id = ${apiKey['id']}`.pipe(
						Effect.forkDetach,
					)

					return yield* Effect.provideService(effect, ApiKeyContext, {
						scopes: apiKey['scopes'] as ReadonlyArray<string>,
						keyId: apiKey['id'] as string,
					})
				}).pipe(
					Effect.catch(e =>
						(e as { _tag?: string })._tag === 'Unauthorized'
							? Effect.fail(e as Unauthorized)
							: Effect.die(e),
					),
				),
		}
	}),
)
