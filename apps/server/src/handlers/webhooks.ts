import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi } from '@batuda/controllers'

import { WebhookService } from '../services/webhooks'

export const WebhooksLive = HttpApiBuilder.group(
	BatudaApi,
	'webhooks',
	handlers =>
		Effect.gen(function* () {
			const svc = yield* WebhookService
			return handlers
				.handle('list', () =>
					Effect.gen(function* () {
						return yield* svc.list()
					}).pipe(Effect.orDie),
				)
				.handle('create', _ =>
					Effect.gen(function* () {
						const rows = yield* svc.create(_.payload as any)
						yield* Effect.logInfo('Webhook endpoint created').pipe(
							Effect.annotateLogs({ event: 'webhook.created' }),
						)
						return rows[0]
					}).pipe(Effect.orDie),
				)
				.handle('update', _ =>
					Effect.gen(function* () {
						const rows = yield* svc.update(_.params.id, _.payload as any)
						return rows[0]
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
