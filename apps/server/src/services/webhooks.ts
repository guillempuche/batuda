import { createHmac } from 'node:crypto'

import { Effect, Layer, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

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
				fire: (event: string, payload: unknown) =>
					Effect.gen(function* () {
						const endpoints = yield* sql`
							SELECT * FROM webhook_endpoints WHERE is_active = true
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
												'X-Forja-Event': event,
												'X-Forja-Signature': hmacSign(endpoint.secret, payload),
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

				list: () => sql`SELECT * FROM webhook_endpoints`,

				create: (data: Record<string, unknown>) =>
					sql`INSERT INTO webhook_endpoints ${sql.insert(data)} RETURNING *`,

				update: (id: string, data: Record<string, unknown>) =>
					sql`UPDATE webhook_endpoints SET ${sql.update(data, ['id'])} WHERE id = ${id} RETURNING *`,

				remove: (id: string) =>
					sql`DELETE FROM webhook_endpoints WHERE id = ${id}`,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
