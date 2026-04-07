import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { ForjaApi } from '../api'
import { EmailService } from '../services/email'

export const EmailLive = HttpApiBuilder.group(ForjaApi, 'email', handlers =>
	Effect.gen(function* () {
		const svc = yield* EmailService
		return handlers
			.handle('send', _ =>
				svc
					.send(
						_.payload.inboxId,
						_.payload.to,
						_.payload.subject,
						{
							...(_.payload.text !== undefined && {
								text: _.payload.text,
							}),
							...(_.payload.html !== undefined && {
								html: _.payload.html,
							}),
						},
						_.payload.companyId,
						_.payload.contactId,
					)
					.pipe(
						// EmailSuppressed flows through the typed error channel (409).
						// Anything else (EmailSendError, SqlError) becomes a defect.
						Effect.catchTag('EmailSendError', e => Effect.die(e)),
						Effect.catchTag('SqlError', e => Effect.die(e)),
					),
			)
			.handle('reply', _ =>
				svc
					.reply(_.payload.threadId, {
						...(_.payload.text !== undefined && {
							text: _.payload.text,
						}),
						...(_.payload.html !== undefined && {
							html: _.payload.html,
						}),
					})
					.pipe(
						Effect.catchTag('EmailSendError', e => Effect.die(e)),
						Effect.catchTag('NotFound', e => Effect.die(e)),
						Effect.catchTag('EmailError', e => Effect.die(e)),
						Effect.catchTag('SqlError', e => Effect.die(e)),
					),
			)
			.handle('listThreads', _ =>
				svc.listThreads({
					...(_.query.inboxId !== undefined && {
						inboxId: _.query.inboxId,
					}),
					...(_.query.companyId !== undefined && {
						companyId: _.query.companyId,
					}),
					...(_.query.limit !== undefined && {
						limit: _.query.limit,
					}),
					...(_.query.offset !== undefined && {
						offset: _.query.offset,
					}),
				}),
			)
			.handle('getThread', _ =>
				svc.getThread(_.params.threadId).pipe(Effect.orDie),
			)
			.handle('listMessages', _ =>
				svc.listMessages({
					...(_.query.contactId !== undefined && {
						contactId: _.query.contactId,
					}),
					...(_.query.companyId !== undefined && {
						companyId: _.query.companyId,
					}),
					...(_.query.status !== undefined && {
						status: _.query.status,
					}),
					...(_.query.limit !== undefined && {
						limit: _.query.limit,
					}),
					...(_.query.offset !== undefined && {
						offset: _.query.offset,
					}),
				}),
			)
			.handle('getMessage', _ =>
				svc.getMessage(_.params.messageId).pipe(Effect.orDie),
			)
			.handle('listInboxes', () => svc.listInboxes().pipe(Effect.orDie))
	}),
)
