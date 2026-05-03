import { Effect, Stream } from 'effect'
import { HttpServerResponse, Multipart } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BadRequest, BatudaApi } from '@batuda/controllers'

import { EmailService } from '../services/email'
import {
	EmailAttachmentStaging,
	type StagingRef,
} from '../services/email-attachment-staging'

export const EmailLive = HttpApiBuilder.group(BatudaApi, 'email', handlers =>
	Effect.gen(function* () {
		const svc = yield* EmailService
		const staging = yield* EmailAttachmentStaging

		// Convert the on-wire ref shape to the staging service's StagingRef.
		// Defaults `inline: false` when caller omits it — same policy the
		// compose tray uses for non-image attachments.
		const toStagingRefs = (
			refs:
				| ReadonlyArray<{
						readonly stagingId: string
						readonly inline?: boolean | undefined
						readonly cid?: string | undefined
				  }>
				| undefined,
		): readonly StagingRef[] =>
			refs
				? refs.map(r => ({
						stagingId: r.stagingId,
						inline: r.inline ?? false,
						...(r.cid !== undefined && { cid: r.cid }),
					}))
				: []

		return (
			handlers
				.handle('send', _ =>
					svc
						.send(
							_.payload.inboxId,
							typeof _.payload.to === 'string'
								? _.payload.to
								: [..._.payload.to],
							_.payload.subject,
							_.payload.bodyJson,
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
								...(_.payload.preview !== undefined && {
									preview: _.payload.preview,
								}),
								...(_.payload.attachments !== undefined && {
									attachmentRefs: toStagingRefs(_.payload.attachments),
								}),
								...(_.payload.skipFooter !== undefined && {
									skipFooter: _.payload.skipFooter,
								}),
							},
						)
						.pipe(
							// Surface the inbox-state failures as the route's declared
							// 409s; collapse internal errors to die().
							Effect.catchTag('EmailError', e => Effect.die(e)),
							Effect.catchTag('SqlError', e => Effect.die(e)),
						),
				)
				.handle('reply', _ =>
					svc
						.reply(_.payload.threadId, _.payload.bodyJson, {
							...(_.payload.cc !== undefined && { cc: [..._.payload.cc] }),
							...(_.payload.bcc !== undefined && {
								bcc: [..._.payload.bcc],
							}),
							...(_.payload.preview !== undefined && {
								preview: _.payload.preview,
							}),
							...(_.payload.attachments !== undefined && {
								attachmentRefs: toStagingRefs(_.payload.attachments),
							}),
							...(_.payload.skipFooter !== undefined && {
								skipFooter: _.payload.skipFooter,
							}),
						})
						.pipe(
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
					svc.getThread(_.params.threadId).pipe(
						Effect.catchTag('NotFound', e =>
							Effect.succeed(
								HttpServerResponse.jsonUnsafe(
									{ _tag: 'NotFound', entity: e.entity, id: e.id },
									{ status: 404 },
								),
							),
						),
						Effect.orDie,
					),
				)
				.handle('updateThreadStatus', _ =>
					svc
						.updateThreadStatus(_.params.threadId, _.payload.status)
						.pipe(
							Effect.catch(e =>
								e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
							),
						),
				)
				.handle('markThreadRead', _ => svc.markThreadRead(_.params.threadId))
				.handle('markThreadUnread', _ =>
					svc.markThreadUnread(_.params.threadId),
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
					svc
						.getMessage(_.params.messageId)
						.pipe(
							Effect.catch(e =>
								e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
							),
						),
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
				.handle('listProviderPresets', () => svc.listProviderPresets())
				.handle('inboxStatus', () => svc.inboxStatus())
				.handle('createInbox', _ =>
					svc
						.createInbox({
							email: _.payload.email,
							...(_.payload.displayName !== undefined && {
								displayName: _.payload.displayName,
							}),
							purpose: _.payload.purpose,
							...(_.payload.ownerUserId !== undefined && {
								ownerUserId: _.payload.ownerUserId,
							}),
							...(_.payload.isPrivate !== undefined && {
								isPrivate: _.payload.isPrivate,
							}),
							...(_.payload.isDefault !== undefined && {
								isDefault: _.payload.isDefault,
							}),
							imapHost: _.payload.imapHost,
							imapPort: _.payload.imapPort,
							imapSecurity: _.payload.imapSecurity,
							smtpHost: _.payload.smtpHost,
							smtpPort: _.payload.smtpPort,
							smtpSecurity: _.payload.smtpSecurity,
							username: _.payload.username,
							password: _.payload.password,
						})
						.pipe(Effect.catchTag('SqlError', e => Effect.die(e))),
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
							...(_.payload.isPrivate !== undefined && {
								isPrivate: _.payload.isPrivate,
							}),
							...(_.payload.isDefault !== undefined && {
								isDefault: _.payload.isDefault,
							}),
							...(_.payload.active !== undefined && {
								active: _.payload.active,
							}),
							...(_.payload.imapHost !== undefined && {
								imapHost: _.payload.imapHost,
							}),
							...(_.payload.imapPort !== undefined && {
								imapPort: _.payload.imapPort,
							}),
							...(_.payload.imapSecurity !== undefined && {
								imapSecurity: _.payload.imapSecurity,
							}),
							...(_.payload.smtpHost !== undefined && {
								smtpHost: _.payload.smtpHost,
							}),
							...(_.payload.smtpPort !== undefined && {
								smtpPort: _.payload.smtpPort,
							}),
							...(_.payload.smtpSecurity !== undefined && {
								smtpSecurity: _.payload.smtpSecurity,
							}),
							...(_.payload.username !== undefined && {
								username: _.payload.username,
							}),
							...(_.payload.password !== undefined && {
								password: _.payload.password,
							}),
						})
						.pipe(Effect.catchTag('SqlError', e => Effect.die(e))),
				)
				.handle('deleteInbox', _ =>
					svc.deleteInbox(_.params.id).pipe(
						Effect.map(() => undefined as void),
						Effect.catchTag('NotFound', e => Effect.die(e)),
						Effect.catchTag('SqlError', e => Effect.die(e)),
					),
				)
				.handle('testInbox', _ =>
					svc
						.testInbox(_.params.id)
						.pipe(Effect.catchTag('SqlError', e => Effect.die(e))),
				)
				.handle('setPrimaryInbox', _ =>
					svc
						.setPrimaryInbox(_.params.id)
						.pipe(Effect.catchTag('SqlError', e => Effect.die(e))),
				)
				// ── Drafts ──
				.handle('createDraft', _ =>
					svc
						.createDraft(
							_.payload.inboxId,
							{
								...(_.payload.to !== undefined && {
									to:
										typeof _.payload.to === 'string'
											? _.payload.to
											: [..._.payload.to],
								}),
								...(_.payload.cc !== undefined && { cc: [..._.payload.cc] }),
								...(_.payload.bcc !== undefined && { bcc: [..._.payload.bcc] }),
								...(_.payload.subject !== undefined && {
									subject: _.payload.subject,
								}),
								...(_.payload.bodyJson !== undefined && {
									bodyJson: _.payload.bodyJson,
								}),
								...(_.payload.inReplyTo !== undefined && {
									inReplyTo: _.payload.inReplyTo,
								}),
							},
							{
								...(_.payload.companyId !== undefined && {
									companyId: _.payload.companyId,
								}),
								...(_.payload.contactId !== undefined && {
									contactId: _.payload.contactId,
								}),
								...(_.payload.mode !== undefined && { mode: _.payload.mode }),
								...(_.payload.threadLinkId !== undefined && {
									threadLinkId: _.payload.threadLinkId,
								}),
							},
						)
						.pipe(Effect.orDie),
				)
				.handle('listDrafts', _ =>
					svc.listDrafts(_.query.inboxId).pipe(Effect.orDie),
				)
				.handle('getDraft', _ =>
					svc.getDraft(_.query.inboxId, _.params.draftId).pipe(Effect.orDie),
				)
				.handle('updateDraft', _ =>
					svc
						.updateDraft(_.payload.inboxId, _.params.draftId, {
							...(_.payload.to !== undefined && {
								to:
									typeof _.payload.to === 'string'
										? _.payload.to
										: [..._.payload.to],
							}),
							...(_.payload.cc !== undefined && { cc: [..._.payload.cc] }),
							...(_.payload.bcc !== undefined && { bcc: [..._.payload.bcc] }),
							...(_.payload.subject !== undefined && {
								subject: _.payload.subject,
							}),
							...(_.payload.bodyJson !== undefined && {
								bodyJson: _.payload.bodyJson,
							}),
						})
						.pipe(Effect.orDie),
				)
				.handle('deleteDraft', _ =>
					svc.deleteDraft(_.query.inboxId, _.params.draftId).pipe(Effect.orDie),
				)
				.handle('sendDraft', _ =>
					svc.sendDraft(_.payload.inboxId, _.params.draftId).pipe(
						Effect.catchTags({
							EmailError: e =>
								Effect.fail(new BadRequest({ message: e.message })),
							NotFound: e => Effect.die(e),
							InboxInactive: e => Effect.die(e),
							GrantUnavailable: e => Effect.die(e),
							BadRequest: e => Effect.die(e),
							SqlError: e => Effect.die(e),
						}),
					),
				)
				// ── Footers ──
				.handle('listFooters', _ =>
					svc.listFooters(_.params.inboxId).pipe(Effect.orDie),
				)
				.handle('createFooter', _ =>
					svc
						.createFooter({
							inboxId: _.params.inboxId,
							name: _.payload.name,
							bodyJson: _.payload.bodyJson,
							...(_.payload.isDefault !== undefined && {
								isDefault: _.payload.isDefault,
							}),
						})
						.pipe(Effect.orDie),
				)
				.handle('getFooter', _ =>
					svc.getFooter(_.params.id).pipe(
						Effect.catchTag('NotFound', e => Effect.fail(e)),
						Effect.catchTag('SqlError', e => Effect.die(e)),
					),
				)
				.handle('updateFooter', _ =>
					svc
						.updateFooter(_.params.id, {
							...(_.payload.name !== undefined && { name: _.payload.name }),
							...(_.payload.bodyJson !== undefined && {
								bodyJson: _.payload.bodyJson,
							}),
							...(_.payload.isDefault !== undefined && {
								isDefault: _.payload.isDefault,
							}),
						})
						.pipe(
							Effect.catchTag('NotFound', e => Effect.fail(e)),
							Effect.catchTag('SqlError', e => Effect.die(e)),
						),
				)
				.handle('deleteFooter', _ => svc.deleteFooter(_.params.id))
				.handle('discardStagedAttachment', _ =>
					staging
						.discard(_.query.inboxId, _.params.stagingId)
						.pipe(Effect.catchTag('BadRequest', e => Effect.fail(e))),
				)
				.handleRaw(
					'stageAttachment',
					Effect.fnUntraced(function* ({ request }) {
						let bytes: Uint8Array | undefined
						let filename: string | undefined
						let contentType: string | undefined
						let inboxId: string | undefined
						let inline = false
						let draftId: string | undefined

						yield* request.multipartStream.pipe(
							Stream.runForEach(part =>
								Effect.gen(function* () {
									if (Multipart.isFile(part) && part.key === 'file') {
										bytes = yield* part.contentEffect
										filename = part.name ?? 'attachment'
										contentType = part.contentType
										return
									}
									if (Multipart.isField(part)) {
										const value = part.value
										if (part.key === 'inboxId' && typeof value === 'string') {
											inboxId = value
										} else if (
											part.key === 'inline' &&
											typeof value === 'string'
										) {
											inline = value === 'true'
										} else if (
											part.key === 'draftId' &&
											typeof value === 'string'
										) {
											draftId = value
										}
									}
								}),
							),
							Effect.orDie,
						)

						if (!bytes || !contentType) {
							return HttpServerResponse.jsonUnsafe(
								{
									_tag: 'BadRequest',
									message: 'Missing file part in multipart upload',
								},
								{ status: 400 },
							)
						}
						if (!inboxId) {
							return HttpServerResponse.jsonUnsafe(
								{
									_tag: 'BadRequest',
									message: 'Missing inboxId field in multipart upload',
								},
								{ status: 400 },
							)
						}

						const result = yield* staging
							.stage({
								inboxId,
								bytes,
								filename: filename ?? 'attachment',
								contentType,
								isInline: inline,
								...(draftId !== undefined && { draftId }),
							})
							.pipe(
								Effect.catchTag('BadRequest', err =>
									Effect.succeed(
										HttpServerResponse.jsonUnsafe(
											{ _tag: 'BadRequest', message: err.message },
											{ status: 400 },
										),
									),
								),
							)

						if (
							typeof result === 'object' &&
							result !== null &&
							'stagingId' in result
						) {
							return HttpServerResponse.jsonUnsafe(result)
						}
						return result
					}),
				)
				.handleRaw(
					'downloadAttachment',
					Effect.fnUntraced(function* ({ params }) {
						const piped = yield* svc
							.streamAttachment(params.messageId, params.attachmentId)
							.pipe(
								Effect.catchTags({
									NotFound: err =>
										Effect.succeed(
											HttpServerResponse.jsonUnsafe(
												{ _tag: 'NotFound', entity: err.entity, id: err.id },
												{ status: 404 },
											),
										),
									EmailError: err =>
										Effect.succeed(
											HttpServerResponse.jsonUnsafe(
												{ _tag: 'EmailError', message: err.message },
												{ status: 502 },
											),
										),
								}),
							)
						// If `piped` is already an HTTP response (one of the catch arms)
						// hand it back unchanged. Otherwise wrap the provider stream.
						if (HttpServerResponse.isHttpServerResponse(piped)) {
							return piped
						}
						const disposition = piped.filename
							? `attachment; filename="${piped.filename.replace(/"/g, '')}"`
							: 'attachment'
						const body = Stream.fromReadableStream({
							evaluate: () => piped.stream,
							onError: e =>
								new Error(
									`attachment stream: ${e instanceof Error ? e.message : String(e)}`,
								),
						})
						return HttpServerResponse.stream(body, {
							contentType: piped.contentType,
							...(piped.size !== undefined && { contentLength: piped.size }),
							headers: { 'content-disposition': disposition },
						})
					}),
				)
		)
	}),
)
