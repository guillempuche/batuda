import { Effect, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi } from '@batuda/controllers'
import { WebhookEndpoint } from '@batuda/domain'

import { WebhookService } from '../services/webhooks'

const decodeWebhook = Schema.decodeUnknownEffect(WebhookEndpoint)
const decodeWebhooks = Schema.decodeUnknownEffect(Schema.Array(WebhookEndpoint))

export const WebhooksLive = HttpApiBuilder.group(
	BatudaApi,
	'webhooks',
	handlers =>
		Effect.gen(function* () {
			const svc = yield* WebhookService
			return handlers
				.handle('list', () =>
					Effect.gen(function* () {
						const rows = yield* svc.list()
						return yield* decodeWebhooks(rows)
					}).pipe(Effect.orDie),
				)
				.handle('create', _ =>
					Effect.gen(function* () {
						const rows = yield* svc.create(_.payload)
						yield* Effect.logInfo('Webhook endpoint created').pipe(
							Effect.annotateLogs({ event: 'webhook.created' }),
						)
						const created = rows[0]
						if (created === undefined)
							return yield* Effect.die(
								new Error('webhook insert returned no row'),
							)
						return yield* decodeWebhook(created)
					}).pipe(Effect.orDie),
				)
				.handle('update', _ =>
					Effect.gen(function* () {
						const rows = yield* svc.update(_.params.id, _.payload)
						const row = rows[0]
						return row === undefined ? null : yield* decodeWebhook(row)
					}).pipe(Effect.orDie),
				)
				.handle('remove', _ =>
					Effect.gen(function* () {
						yield* svc.remove(_.params.id)
						yield* Effect.logInfo('Webhook endpoint removed').pipe(
							Effect.annotateLogs({
								event: 'webhook.removed',
								webhookId: _.params.id,
							}),
						)
					}).pipe(Effect.orDie),
				)
				.handle('test', _ =>
					svc
						.fire('test', { webhookId: _.params.id })
						.pipe(Effect.asVoid, Effect.orDie),
				)
		}),
)
