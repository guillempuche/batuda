import { createHmac } from 'node:crypto'

import { Effect, Layer, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'

const hmacSign = (secret: string | null, payload: unknown): string => {
	if (!secret) return ''
	return createHmac('sha256', secret)
		.update(JSON.stringify(payload))
		.digest('hex')
}

export class WebhookService extends ServiceMap.Service<WebhookService>()(
	'WebhookService',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient

			return {
				// `fire` is called from services that already have CurrentOrg
				// in scope, so we resolve it inside the effect and only fan
				// out to endpoints belonging to that org.
				fire: (event: string, payload: unknown) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const endpoints = yield* sql`
							SELECT * FROM webhook_endpoints
							WHERE is_active = true
							  AND organization_id = ${currentOrg.id}
						`

						const matching = endpoints.filter((ep: any) =>
							ep.events.includes(event),
						)

						yield* Effect.logInfo('Webhook fan-out').pipe(
							Effect.annotateLogs({
								event: 'webhook.fired',
								webhookEvent: event,
								endpointCount: matching.length,
							}),
						)

						yield* Effect.forEach(
							matching,
							(endpoint: any) =>
								Effect.tryPromise({
									try: () =>
										fetch(endpoint.url, {
											method: 'POST',
											headers: {
												'Content-Type': 'application/json',
												'X-Batuda-Event': event,
												'X-Batuda-Signature': hmacSign(
													endpoint.secret,
													payload,
												),
											},
											body: JSON.stringify({
												event,
												payload,
												timestamp: new Date().toISOString(),
											}),
										}),
									catch: e =>
										new Error(`Webhook delivery failed: ${endpoint.url}: ${e}`),
								}).pipe(
									Effect.catch((error: Error) =>
										Effect.logError('Webhook delivery failed').pipe(
											Effect.annotateLogs({
												event: 'webhook.failed',
												endpointUrl: endpoint.url,
												webhookEvent: event,
												error: error.message,
											}),
										),
									),
								),
							{ concurrency: 'unbounded' },
						)
					}).pipe(Effect.forkDetach),

				list: () =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						return yield* sql`
							SELECT * FROM webhook_endpoints
							WHERE organization_id = ${currentOrg.id}
						`
					}),

				create: (data: Record<string, unknown>) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						return yield* sql`INSERT INTO webhook_endpoints ${sql.insert({ ...data, organizationId: currentOrg.id })} RETURNING *`
					}),

				update: (id: string, data: Record<string, unknown>) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						return yield* sql`
							UPDATE webhook_endpoints SET ${sql.update(data, ['id'])}
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							RETURNING *
						`
					}),

				remove: (id: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						return yield* sql`
							DELETE FROM webhook_endpoints
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
						`
					}),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
