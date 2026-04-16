import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { ForjaApi } from '@engranatge/controllers'

import { EmailService } from '../services/email'

export const EmailLive = HttpApiBuilder.group(ForjaApi, 'email', handlers =>
	Effect.gen(function* () {
		const svc = yield* EmailService
		return handlers
			.handle('send', _ =>
				svc
					.send(
						_.payload.inboxId,
						typeof _.payload.to === 'string' ? _.payload.to : [..._.payload.to],
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
						{
							...(_.payload.cc !== undefined && { cc: [..._.payload.cc] }),
							...(_.payload.bcc !== undefined && {
								bcc: [..._.payload.bcc],
							}),
							...(_.payload.replyTo !== undefined && {
								replyTo: _.payload.replyTo,
							}),
						},
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
					.reply(
						_.payload.threadId,
						{
							...(_.payload.text !== undefined && {
								text: _.payload.text,
							}),
							...(_.payload.html !== undefined && {
								html: _.payload.html,
							}),
						},
						{
							...(_.payload.cc !== undefined && { cc: [..._.payload.cc] }),
							...(_.payload.bcc !== undefined && {
								bcc: [..._.payload.bcc],
							}),
						},
					)
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
					...(_.query.status !== undefined && { status: _.query.status }),
					...(_.query.purpose !== undefined && {
						purpose: _.query.purpose,
					}),
					...(_.query.query !== undefined && { query: _.query.query }),
					...(_.query.limit !== undefined && { limit: _.query.limit }),
					...(_.query.offset !== undefined && { offset: _.query.offset }),
				}),
			)
			.handle('getThread', _ =>
				svc.getThread(_.params.threadId).pipe(Effect.orDie),
			)
			.handle('updateThreadStatus', _ =>
				svc.updateThreadStatus(_.params.threadId, _.payload.status).pipe(
					Effect.catchTag('NotFound', e => Effect.die(e)),
					Effect.catchTag('SqlError', e => Effect.die(e)),
					Effect.orDie,
				),
			)
			.handle('markThreadRead', _ => svc.markThreadRead(_.params.threadId))
			.handle('markThreadUnread', _ => svc.markThreadUnread(_.params.threadId))
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
			.handle('listInboxes', _ =>
				svc.listLocalInboxes({
					...(_.query.purpose !== undefined && {
						purpose: _.query.purpose,
					}),
					...(_.query.active !== undefined && {
						active: _.query.active === 'true',
					}),
					...(_.query.ownerUserId !== undefined && {
						ownerUserId: _.query.ownerUserId,
					}),
				}),
			)
			.handle('createInbox', _ =>
				svc
					.createInbox({
						...(_.payload.username !== undefined && {
							username: _.payload.username,
						}),
						...(_.payload.domain !== undefined && {
							domain: _.payload.domain,
						}),
						...(_.payload.displayName !== undefined && {
							displayName: _.payload.displayName,
						}),
						purpose: _.payload.purpose,
						...(_.payload.ownerUserId !== undefined && {
							ownerUserId: _.payload.ownerUserId,
						}),
						...(_.payload.isDefault !== undefined && {
							isDefault: _.payload.isDefault,
						}),
					})
					.pipe(
						Effect.catchTag('EmailError', e => Effect.die(e)),
						Effect.catchTag('SqlError', e => Effect.die(e)),
					),
			)
			.handle('updateInbox', _ =>
				svc
					.updateInbox(_.params.id, {
						...(_.payload.displayName !== undefined && {
							displayName: _.payload.displayName,
						}),
						...(_.payload.purpose !== undefined && {
							purpose: _.payload.purpose,
						}),
						...(_.payload.ownerUserId !== undefined && {
							ownerUserId: _.payload.ownerUserId,
						}),
						...(_.payload.isDefault !== undefined && {
							isDefault: _.payload.isDefault,
						}),
						...(_.payload.active !== undefined && {
							active: _.payload.active,
						}),
					})
					.pipe(
						Effect.catchTag('NotFound', e => Effect.die(e)),
						Effect.catchTag('SqlError', e => Effect.die(e)),
					),
			)
			.handle('syncInboxes', () => svc.syncInboxes())
	}),
)
