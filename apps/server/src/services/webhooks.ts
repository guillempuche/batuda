import { createHmac } from 'node:crypto'

import { Cause, DateTime, Effect, Layer, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'

const hmacSign = (secret: string | null, payload: unknown): string => {
	if (!secret) return ''
	return createHmac('sha256', secret)
		.update(JSON.stringify(payload))
		.digest('hex')
}

// Just the columns fire() reads; the query returns the whole row.
export type WebhookEndpoint = {
	readonly url: string
	readonly secret: string | null
	readonly events: ReadonlyArray<string>
}

// An endpoint is notified for an event only if it subscribed to that event.
export const matchingEndpoints = (
	endpoints: ReadonlyArray<WebhookEndpoint>,
	event: string,
): ReadonlyArray<WebhookEndpoint> =>
	endpoints.filter(ep => ep.events.includes(event))

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
						const endpoints = yield* sql<WebhookEndpoint>`
							SELECT * FROM webhook_endpoints
							WHERE is_active = true
							  AND organization_id = ${currentOrg.id}
						`

						const matching = matchingEndpoints(endpoints, event)

						yield* Effect.logInfo('Webhook fan-out').pipe(
							Effect.annotateLogs({
								event: 'webhook.fired',
								webhookEvent: event,
								endpointCount: matching.length,
							}),
						)

						// Send the webhooks in the background, but only after the lookup
						// above has finished. The lookup has to run as part of the original
						// request so it reads from the right place; sending it to the
						// background too could make it run too late and read the wrong data.
						yield* Effect.forEach(
							matching,
							endpoint =>
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
												timestamp: DateTime.formatIso(DateTime.nowUnsafe()),
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
						).pipe(
							// The per-endpoint catch above handles delivery failures, but a
							// DEFECT inside this detached fiber (a bug, not a fetch
							// rejection) would otherwise vanish with no trace. Catch the
							// whole cause so it's logged; let a genuine interrupt
							// (shutdown/cancel) propagate. Mirrors the research event sink.
							Effect.catchCause(cause =>
								Cause.hasInterruptsOnly(cause)
									? Effect.interrupt
									: Effect.logError('Webhook fan-out failed').pipe(
											Effect.annotateLogs({
												event: 'webhook.fanout.failed',
												webhookEvent: event,
												cause: Cause.pretty(cause),
											}),
										),
							),
							Effect.forkDetach,
						)
					}),

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
