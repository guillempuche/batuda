import { Effect, Layer, ServiceMap } from 'effect'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { EmailError, EmailSuppressed, NotFound } from '../errors.js'
import { EmailProvider } from './email-provider.js'
import { WebhookService } from './webhooks.js'

type ContactSuppressionRow = {
	email_status: 'unknown' | 'valid' | 'bounced' | 'complained'
	email_status_reason: string | null
}

const firstRecipient = (to: string | string[]): string =>
	Array.isArray(to) ? (to[0] ?? '') : to

export class EmailService extends ServiceMap.Service<EmailService>()(
	'EmailService',
	{
		make: Effect.gen(function* () {
			const provider = yield* EmailProvider
			const sql = yield* SqlClient.SqlClient
			const webhooks = yield* WebhookService

			const assertContactNotSuppressed = (
				contactId: string,
				recipient: string | string[],
			) =>
				Effect.gen(function* () {
					const rows = yield* sql<ContactSuppressionRow>`
						SELECT email_status, email_status_reason
						FROM contacts
						WHERE id = ${contactId}
						LIMIT 1
					`
					const row = rows[0]
					if (
						row &&
						(row.email_status === 'bounced' ||
							row.email_status === 'complained')
					) {
						return yield* new EmailSuppressed({
							contactId,
							recipient: firstRecipient(recipient),
							status: row.email_status,
							reason: row.email_status_reason,
						})
					}
				})

			return {
				send: (
					inboxId: string,
					to: string | string[],
					subject: string,
					body: { text?: string; html?: string },
					companyId: string,
					contactId?: string,
				) =>
					Effect.gen(function* () {
						// 1) Fast-path cache check
						if (contactId) {
							yield* assertContactNotSuppressed(contactId, to)
						}

						// 2) Provider call — self-heal cache on stale-suppressed rejection
						const result = yield* provider
							.send(inboxId, {
								to,
								subject,
								text: body.text,
								html: body.html,
							})
							.pipe(
								Effect.catchTag('EmailSendError', err =>
									Effect.gen(function* () {
										if (err.kind !== 'suppressed') {
											return yield* Effect.fail(err)
										}
										if (contactId) {
											yield* sql`
												UPDATE contacts
												SET email_status = 'bounced',
												    email_status_reason = ${err.message},
												    email_status_updated_at = now()
												WHERE id = ${contactId}
											`
										}
										return yield* new EmailSuppressed({
											contactId: contactId ?? null,
											recipient: err.recipient ?? firstRecipient(to),
											status: 'bounced',
											reason: err.message,
										})
									}),
								),
							)

						// 3) Persist thread link, interaction, contact freshness, message row
						yield* sql`
							INSERT INTO email_thread_links ${sql.insert({
								agentmailThreadId: result.threadId,
								agentmailInboxId: inboxId,
								companyId,
								contactId: contactId ?? null,
								subject,
								status: 'open',
							})}
						`

						yield* sql`
							INSERT INTO interactions ${sql.insert({
								companyId,
								contactId: contactId ?? null,
								date: new Date(),
								channel: 'email',
								direction: 'outbound',
								type: 'email',
								subject,
								metadata: JSON.stringify({
									agentmailThreadId: result.threadId,
									agentmailMessageId: result.messageId,
								}),
							})}
						`

						yield* sql`
							UPDATE companies
							SET last_contacted_at = now(), updated_at = now()
							WHERE id = ${companyId}
						`

						yield* sql`
							INSERT INTO email_messages ${sql.insert({
								agentmailMessageId: result.messageId,
								agentmailThreadId: result.threadId,
								agentmailInboxId: inboxId,
								direction: 'outbound',
								companyId,
								contactId: contactId ?? null,
								recipients: JSON.stringify(Array.isArray(to) ? to : [to]),
								status: 'sent',
								statusUpdatedAt: new Date(),
							})}
						`

						yield* Effect.logInfo('Email sent').pipe(
							Effect.annotateLogs({
								event: 'email.sent',
								companyId,
								threadId: result.threadId,
							}),
						)

						return result
					}),

				reply: (
					agentmailThreadId: string,
					body: { text?: string; html?: string },
				) =>
					Effect.gen(function* () {
						const links = yield* sql`
							SELECT * FROM email_thread_links
							WHERE agentmail_thread_id = ${agentmailThreadId}
							LIMIT 1
						`
						if (links.length === 0) {
							return yield* new NotFound({
								entity: 'EmailThreadLink',
								id: agentmailThreadId,
							})
						}
						const link = links[0] as {
							agentmail_inbox_id: string
							company_id: string | null
							contact_id: string | null
						}

						const thread = yield* provider.getThread(
							link.agentmail_inbox_id,
							agentmailThreadId,
						)
						const lastMessage = thread.messages[thread.messages.length - 1]
						if (!lastMessage) {
							return yield* new EmailError({
								message: `Thread ${agentmailThreadId} has no messages`,
							})
						}

						// Pull recipient address(es) for the reply target
						const replyRecipients = lastMessage.from
							? [lastMessage.from]
							: lastMessage.to

						// Fast-path cache check
						if (link.contact_id) {
							yield* assertContactNotSuppressed(
								link.contact_id,
								replyRecipients,
							)
						}

						const result = yield* provider
							.reply(link.agentmail_inbox_id, lastMessage.messageId, {
								text: body.text,
								html: body.html,
							})
							.pipe(
								Effect.catchTag('EmailSendError', err =>
									Effect.gen(function* () {
										if (err.kind !== 'suppressed') {
											return yield* Effect.fail(err)
										}
										if (link.contact_id) {
											yield* sql`
												UPDATE contacts
												SET email_status = 'bounced',
												    email_status_reason = ${err.message},
												    email_status_updated_at = now()
												WHERE id = ${link.contact_id}
											`
										}
										return yield* new EmailSuppressed({
											contactId: link.contact_id,
											recipient:
												err.recipient ?? firstRecipient(replyRecipients),
											status: 'bounced',
											reason: err.message,
										})
									}),
								),
							)

						if (link.company_id) {
							yield* sql`
								INSERT INTO interactions ${sql.insert({
									companyId: link.company_id,
									contactId: link.contact_id,
									date: new Date(),
									channel: 'email',
									direction: 'outbound',
									type: 'email',
									subject: thread.subject ?? null,
									metadata: JSON.stringify({
										agentmailThreadId,
										agentmailMessageId: result.messageId,
									}),
								})}
							`

							yield* sql`
								UPDATE companies
								SET last_contacted_at = now(), updated_at = now()
								WHERE id = ${link.company_id}
							`
						}

						yield* sql`
							INSERT INTO email_messages ${sql.insert({
								agentmailMessageId: result.messageId,
								agentmailThreadId,
								agentmailInboxId: link.agentmail_inbox_id,
								direction: 'outbound',
								companyId: link.company_id,
								contactId: link.contact_id,
								recipients: JSON.stringify(replyRecipients),
								status: 'sent',
								statusUpdatedAt: new Date(),
							})}
						`

						yield* Effect.logInfo('Email reply sent').pipe(
							Effect.annotateLogs({
								event: 'email.replied',
								threadId: agentmailThreadId,
							}),
						)

						return result
					}),

				handleInboundWebhook: (payload: {
					inbox_id: string
					thread_id: string
					message_id: string
					from: string
					subject?: string
				}) =>
					Effect.gen(function* () {
						const existingLinks = yield* sql`
							SELECT * FROM email_thread_links
							WHERE agentmail_thread_id = ${payload.thread_id}
							LIMIT 1
						`

						let companyId: string | null = null
						let contactId: string | null = null

						if (existingLinks.length > 0) {
							const link = existingLinks[0] as {
								company_id: string | null
								contact_id: string | null
							}
							companyId = link.company_id
							contactId = link.contact_id
						} else {
							const contacts = yield* sql`
								SELECT c.id as contact_id, c.company_id
								FROM contacts c
								WHERE c.email = ${payload.from}
								LIMIT 1
							`
							if (contacts.length > 0) {
								const contact = contacts[0] as {
									contact_id: string
									company_id: string
								}
								contactId = contact.contact_id
								companyId = contact.company_id
							}

							yield* sql`
								INSERT INTO email_thread_links ${sql.insert({
									agentmailThreadId: payload.thread_id,
									agentmailInboxId: payload.inbox_id,
									companyId,
									contactId,
									subject: payload.subject ?? null,
									status: 'open',
								})}
							`
						}

						if (companyId) {
							yield* sql`
								INSERT INTO interactions ${sql.insert({
									companyId,
									contactId,
									date: new Date(),
									channel: 'email',
									direction: 'inbound',
									type: 'email',
									subject: payload.subject ?? null,
									metadata: JSON.stringify({
										agentmailThreadId: payload.thread_id,
										agentmailMessageId: payload.message_id,
										from: payload.from,
									}),
								})}
							`

							yield* sql`
								UPDATE companies
								SET last_contacted_at = now(), updated_at = now()
								WHERE id = ${companyId}
							`
						}

						yield* sql`
							INSERT INTO email_messages ${sql.insert({
								agentmailMessageId: payload.message_id,
								agentmailThreadId: payload.thread_id,
								agentmailInboxId: payload.inbox_id,
								direction: 'inbound',
								companyId,
								contactId,
								recipients: JSON.stringify([payload.from]),
								status: 'delivered',
								statusUpdatedAt: new Date(),
							})}
							ON CONFLICT (agentmail_message_id) DO NOTHING
						`

						yield* webhooks.fire('email.received', {
							threadId: payload.thread_id,
							messageId: payload.message_id,
							from: payload.from,
							subject: payload.subject,
							companyId,
							contactId,
						})

						yield* Effect.logInfo('Inbound email processed').pipe(
							Effect.annotateLogs({
								event: 'email.received',
								threadId: payload.thread_id,
								from: payload.from,
							}),
						)
					}),

				markDelivered: (messageId: string, timestamp: Date) =>
					Effect.gen(function* () {
						yield* sql`
							UPDATE email_messages
							SET status = 'delivered',
							    status_updated_at = ${timestamp},
							    updated_at = now()
							WHERE agentmail_message_id = ${messageId}
						`
						yield* sql`
							UPDATE contacts
							SET email_status = 'valid',
							    email_status_updated_at = now()
							WHERE email_status = 'unknown'
							  AND id IN (
							    SELECT contact_id FROM email_messages
							    WHERE agentmail_message_id = ${messageId}
							      AND contact_id IS NOT NULL
							  )
						`
						yield* Effect.logInfo('Email delivered').pipe(
							Effect.annotateLogs({
								event: 'email.delivered',
								messageId,
							}),
						)
					}),

				markBounced: (
					messageId: string,
					type: string,
					subType: string | null,
					timestamp: Date,
				) =>
					Effect.gen(function* () {
						const isHard = type.toLowerCase() === 'permanent'
						const newStatus = isHard ? 'bounced' : 'bounced_soft'
						const reason = subType ? `${type}/${subType}` : type

						yield* sql`
							UPDATE email_messages
							SET status = ${newStatus},
							    status_reason = ${reason},
							    bounce_type = ${type},
							    bounce_sub_type = ${subType},
							    status_updated_at = ${timestamp},
							    updated_at = now()
							WHERE agentmail_message_id = ${messageId}
						`

						if (isHard) {
							yield* sql`
								UPDATE contacts
								SET email_status = 'bounced',
								    email_status_reason = ${reason},
								    email_status_updated_at = now()
								WHERE id IN (
								  SELECT contact_id FROM email_messages
								  WHERE agentmail_message_id = ${messageId}
								    AND contact_id IS NOT NULL
								)
							`
						} else {
							yield* sql`
								UPDATE contacts
								SET email_soft_bounce_count = email_soft_bounce_count + 1,
								    email_status = CASE
								      WHEN email_soft_bounce_count + 1 >= 3 THEN 'bounced'
								      ELSE email_status
								    END,
								    email_status_reason = CASE
								      WHEN email_soft_bounce_count + 1 >= 3
								      THEN ${`soft_threshold:${reason}`}
								      ELSE email_status_reason
								    END,
								    email_status_updated_at = now()
								WHERE id IN (
								  SELECT contact_id FROM email_messages
								  WHERE agentmail_message_id = ${messageId}
								    AND contact_id IS NOT NULL
								)
							`
						}

						yield* Effect.logWarning('Email bounced').pipe(
							Effect.annotateLogs({
								event: 'email.bounced',
								messageId,
								bounceType: type,
								bounceSubType: subType,
								isHard,
							}),
						)
					}),

				markComplained: (messageId: string, timestamp: Date) =>
					Effect.gen(function* () {
						yield* sql`
							UPDATE email_messages
							SET status = 'complained',
							    status_reason = 'spam_complaint',
							    status_updated_at = ${timestamp},
							    updated_at = now()
							WHERE agentmail_message_id = ${messageId}
						`
						yield* sql`
							UPDATE contacts
							SET email_status = 'complained',
							    email_status_reason = 'spam_complaint',
							    email_status_updated_at = now()
							WHERE id IN (
							  SELECT contact_id FROM email_messages
							  WHERE agentmail_message_id = ${messageId}
							    AND contact_id IS NOT NULL
							)
						`
						yield* Effect.logWarning('Email complaint received').pipe(
							Effect.annotateLogs({
								event: 'email.complained',
								messageId,
							}),
						)
					}),

				markRejected: (
					messageId: string,
					reason: string | null,
					timestamp: Date,
				) =>
					Effect.gen(function* () {
						yield* sql`
							UPDATE email_messages
							SET status = 'rejected',
							    status_reason = ${reason},
							    status_updated_at = ${timestamp},
							    updated_at = now()
							WHERE agentmail_message_id = ${messageId}
						`
						yield* Effect.logWarning('Email rejected').pipe(
							Effect.annotateLogs({
								event: 'email.rejected',
								messageId,
								reason,
							}),
						)
					}),

				getThread: (agentmailThreadId: string) =>
					Effect.gen(function* () {
						const links = yield* sql`
							SELECT * FROM email_thread_links
							WHERE agentmail_thread_id = ${agentmailThreadId}
							LIMIT 1
						`
						if (links.length === 0) {
							return yield* new NotFound({
								entity: 'EmailThreadLink',
								id: agentmailThreadId,
							})
						}
						const link = links[0] as {
							agentmail_inbox_id: string
							company_id: string | null
							contact_id: string | null
						}

						const thread = yield* provider.getThread(
							link.agentmail_inbox_id,
							agentmailThreadId,
						)

						// Enrich messages with stored deliverability state
						const storedMessages = yield* sql`
							SELECT agentmail_message_id, status, status_reason, bounce_type, bounce_sub_type, status_updated_at
							FROM email_messages
							WHERE agentmail_thread_id = ${agentmailThreadId}
						`
						const statusByMessageId = new Map(
							(
								storedMessages as Array<{
									agentmail_message_id: string
									status: string
									status_reason: string | null
									bounce_type: string | null
									bounce_sub_type: string | null
									status_updated_at: Date
								}>
							).map(m => [m.agentmail_message_id, m]),
						)

						const enrichedMessages = thread.messages.map(m => ({
							...m,
							deliverability: statusByMessageId.get(m.messageId) ?? null,
						}))

						return {
							...thread,
							messages: enrichedMessages,
							companyId: link.company_id,
							contactId: link.contact_id,
						}
					}),

				listThreads: (filters?: {
					inboxId?: string
					companyId?: string
					limit?: number
					offset?: number
				}) =>
					Effect.gen(function* () {
						const conditions: Array<Statement.Fragment> = []
						if (filters?.inboxId)
							conditions.push(sql`agentmail_inbox_id = ${filters.inboxId}`)
						if (filters?.companyId)
							conditions.push(sql`company_id = ${filters.companyId}`)

						return yield* sql`
							SELECT * FROM email_thread_links
							WHERE ${sql.and(conditions)}
							ORDER BY updated_at DESC
							LIMIT ${filters?.limit ?? 20}
							OFFSET ${filters?.offset ?? 0}
						`
					}).pipe(Effect.orDie),

				listMessages: (filters?: {
					contactId?: string
					companyId?: string
					status?: string
					limit?: number
					offset?: number
				}) =>
					Effect.gen(function* () {
						const conditions: Array<Statement.Fragment> = []
						if (filters?.contactId)
							conditions.push(sql`contact_id = ${filters.contactId}`)
						if (filters?.companyId)
							conditions.push(sql`company_id = ${filters.companyId}`)
						if (filters?.status)
							conditions.push(sql`status = ${filters.status}`)

						return yield* sql`
							SELECT * FROM email_messages
							${conditions.length > 0 ? sql`WHERE ${sql.and(conditions)}` : sql``}
							ORDER BY status_updated_at DESC
							LIMIT ${filters?.limit ?? 50}
							OFFSET ${filters?.offset ?? 0}
						`
					}).pipe(Effect.orDie),

				getMessage: (messageId: string) =>
					Effect.gen(function* () {
						const rows = yield* sql`
							SELECT * FROM email_messages
							WHERE agentmail_message_id = ${messageId}
							LIMIT 1
						`
						if (rows.length === 0) {
							return yield* new NotFound({
								entity: 'EmailMessage',
								id: messageId,
							})
						}
						return rows[0]
					}),

				listInboxes: () => provider.listInboxes(),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
