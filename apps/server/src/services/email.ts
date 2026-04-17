import { Config, Effect, Layer, Schema, ServiceMap } from 'effect'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { EmailError, EmailSuppressed, NotFound } from '@engranatge/controllers'
import type { InboundClassification } from '@engranatge/domain'

import type {
	CreateDraftParams,
	SendAttachmentInput,
	UpdateDraftParams,
} from './email-provider.js'
import { EmailProvider } from './email-provider.js'
import { WebhookService } from './webhooks.js'

// PgClient.transformResultNames in apps/server/src/db/client.ts converts
// snake_case columns to camelCase on read, so every row type in this file
// is camelCase even though the SQL selects use snake_case.
type ContactSuppressionRow = {
	emailStatus: 'unknown' | 'valid' | 'bounced' | 'complained'
	emailStatusReason: string | null
}

const firstRecipient = (to: string | string[]): string =>
	Array.isArray(to) ? (to[0] ?? '') : to

const encodeClientId = (ctx: {
	companyId?: string
	contactId?: string
	mode?: string
	threadLinkId?: string
}): string => {
	const parts = ['forja:draft']
	if (ctx.companyId) parts.push(`companyId=${ctx.companyId}`)
	if (ctx.contactId) parts.push(`contactId=${ctx.contactId}`)
	if (ctx.mode) parts.push(`mode=${ctx.mode}`)
	if (ctx.threadLinkId) parts.push(`threadLinkId=${ctx.threadLinkId}`)
	return parts.join(';')
}

const parseClientId = (
	clientId: string | undefined,
): {
	companyId: string | null
	contactId: string | null
	mode: string | null
	threadLinkId: string | null
} => {
	const empty: {
		companyId: string | null
		contactId: string | null
		mode: string | null
		threadLinkId: string | null
	} = {
		companyId: null,
		contactId: null,
		mode: null,
		threadLinkId: null,
	}
	if (!clientId?.startsWith('forja:draft')) return empty
	const result = { ...empty }
	for (const part of clientId.split(';')) {
		const eq = part.indexOf('=')
		if (eq === -1) continue
		const key = part.slice(0, eq)
		const val = part.slice(eq + 1)
		if (key === 'companyId') result.companyId = val
		else if (key === 'contactId') result.contactId = val
		else if (key === 'mode') result.mode = val
		else if (key === 'threadLinkId') result.threadLinkId = val
	}
	return result
}

const injectFooter = (
	body: { text?: string; html?: string },
	footer: { html: string; textFallback: string },
): { text?: string; html?: string } => {
	let html = body.html
	if (html !== undefined) {
		const closingBody = html.lastIndexOf('</body>')
		if (closingBody !== -1) {
			html = `${html.slice(0, closingBody)}<div>${footer.html}</div>${html.slice(closingBody)}`
		} else {
			html = `${html}<div>${footer.html}</div>`
		}
	}
	let text = body.text
	if (text !== undefined && footer.textFallback) {
		text = `${text}\n\n${footer.textFallback}`
	}
	return {
		...(text !== undefined && { text }),
		...(html !== undefined && { html }),
	}
}

export class EmailService extends ServiceMap.Service<EmailService>()(
	'EmailService',
	{
		make: Effect.gen(function* () {
			const provider = yield* EmailProvider
			const sql = yield* SqlClient.SqlClient
			const webhooks = yield* WebhookService
			const providerName = yield* Config.schema(
				Schema.Literals(['local-inbox', 'agentmail']),
				'EMAIL_PROVIDER',
			)

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
						(row.emailStatus === 'bounced' || row.emailStatus === 'complained')
					) {
						return yield* new EmailSuppressed({
							contactId,
							recipient: firstRecipient(recipient),
							status: row.emailStatus,
							reason: row.emailStatusReason,
						})
					}
				})

			const resolveInbox = (inboxId: string) =>
				sql<{ id: string; providerInboxId: string }>`
					SELECT id, provider_inbox_id FROM inboxes
					WHERE id = ${inboxId} LIMIT 1
				`.pipe(
					Effect.map(rows => rows[0] ?? null),
					Effect.orDie,
				)

			const resolveLocalInboxId = (providerInboxId: string) =>
				sql<{ id: string }>`
					SELECT id FROM inboxes
					WHERE provider_inbox_id = ${providerInboxId} LIMIT 1
				`.pipe(
					Effect.map(rows => rows[0]?.id ?? null),
					Effect.orDie,
				)

			type FooterRow = { html: string; textFallback: string }
			const resolveDefaultFooter = (localInboxId: string) =>
				sql<FooterRow>`
					SELECT html, text_fallback FROM inbox_footers
					WHERE inbox_id = ${localInboxId} AND is_default = true
					LIMIT 1
				`.pipe(
					Effect.map(rows => rows[0] ?? null),
					Effect.orDie,
				)

			const recordOutbound = (args: {
				result: { messageId: string; threadId: string }
				providerInboxId: string
				localInboxId: string | null
				companyId: string | null
				contactId: string | null
				subject: string | null
				to: string[]
				cc: string[]
				bcc: string[]
				isNewThread: boolean
			}) =>
				Effect.gen(function* () {
					if (args.isNewThread) {
						yield* sql`
							INSERT INTO email_thread_links ${sql.insert({
								provider: providerName,
								providerThreadId: args.result.threadId,
								providerInboxId: args.providerInboxId,
								inboxId: args.localInboxId,
								companyId: args.companyId,
								contactId: args.contactId,
								subject: args.subject,
								status: 'open',
							})}
						`
					}

					if (args.companyId) {
						yield* sql`
							INSERT INTO interactions ${sql.insert({
								companyId: args.companyId,
								contactId: args.contactId,
								date: new Date(),
								channel: 'email',
								direction: 'outbound',
								type: 'email',
								subject: args.subject,
								metadata: JSON.stringify({
									providerThreadId: args.result.threadId,
									providerMessageId: args.result.messageId,
								}),
							})}
						`
						yield* sql`
							UPDATE companies
							SET last_contacted_at = now(), updated_at = now()
							WHERE id = ${args.companyId}
						`
					}

					yield* sql`
						INSERT INTO email_messages ${sql.insert({
							provider: providerName,
							providerMessageId: args.result.messageId,
							providerThreadId: args.result.threadId,
							providerInboxId: args.providerInboxId,
							direction: 'outbound',
							companyId: args.companyId,
							contactId: args.contactId,
							recipients: JSON.stringify({
								to: args.to,
								cc: args.cc,
								bcc: args.bcc,
							}),
							status: 'sent',
							statusUpdatedAt: new Date(),
						})}
					`
				})

			return {
				send: (
					inboxId: string,
					to: string | string[],
					subject: string,
					body: { text?: string; html?: string },
					companyId: string,
					contactId?: string,
					extras?: {
						cc?: string[] | undefined
						bcc?: string[] | undefined
						replyTo?: string | undefined
						attachments?: readonly SendAttachmentInput[] | undefined
						skipFooter?: boolean | undefined
					},
				) =>
					Effect.gen(function* () {
						const cc = extras?.cc ?? []
						const bcc = extras?.bcc ?? []
						const attachments = extras?.attachments ?? []

						const inbox = yield* resolveInbox(inboxId)
						const providerInboxId = inbox?.providerInboxId ?? inboxId
						const localInboxId = inbox?.id ?? null

						if (contactId) {
							yield* assertContactNotSuppressed(contactId, to)
						}

						let finalBody = body
						if (!extras?.skipFooter && localInboxId) {
							const footer = yield* resolveDefaultFooter(localInboxId)
							if (footer) finalBody = injectFooter(body, footer)
						}

						const result = yield* provider
							.send(providerInboxId, {
								to,
								subject,
								...(finalBody.text !== undefined && { text: finalBody.text }),
								...(finalBody.html !== undefined && { html: finalBody.html }),
								...(cc.length > 0 && { cc }),
								...(bcc.length > 0 && { bcc }),
								...(extras?.replyTo !== undefined && {
									replyTo: extras.replyTo,
								}),
								...(attachments.length > 0 && { attachments }),
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

						yield* recordOutbound({
							result,
							providerInboxId,
							localInboxId,
							companyId,
							contactId: contactId ?? null,
							subject,
							to: Array.isArray(to) ? to : [to],
							cc,
							bcc,
							isNewThread: true,
						})

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
					providerThreadId: string,
					body: { text?: string; html?: string },
					extras?: {
						cc?: string[] | undefined
						bcc?: string[] | undefined
						attachments?: readonly SendAttachmentInput[] | undefined
						skipFooter?: boolean | undefined
					},
				) =>
					Effect.gen(function* () {
						const cc = extras?.cc ?? []
						const bcc = extras?.bcc ?? []
						const attachments = extras?.attachments ?? []
						const links = yield* sql`
							SELECT * FROM email_thread_links
							WHERE provider_thread_id = ${providerThreadId}
							LIMIT 1
						`
						if (links.length === 0) {
							return yield* new NotFound({
								entity: 'EmailThreadLink',
								id: providerThreadId,
							})
						}
						const link = links[0] as {
							providerInboxId: string
							inboxId: string | null
							companyId: string | null
							contactId: string | null
						}

						const thread = yield* provider.getThread(
							link.providerInboxId,
							providerThreadId,
						)
						const lastMessage = thread.messages[thread.messages.length - 1]
						if (!lastMessage) {
							return yield* new EmailError({
								message: `Thread ${providerThreadId} has no messages`,
							})
						}

						const replyRecipients = lastMessage.from
							? [lastMessage.from]
							: lastMessage.to

						if (link.contactId) {
							yield* assertContactNotSuppressed(link.contactId, replyRecipients)
						}

						const localInboxId =
							link.inboxId ?? (yield* resolveLocalInboxId(link.providerInboxId))

						let finalBody = body
						if (!extras?.skipFooter && localInboxId) {
							const footer = yield* resolveDefaultFooter(localInboxId)
							if (footer) finalBody = injectFooter(body, footer)
						}

						const result = yield* provider
							.reply(link.providerInboxId, lastMessage.messageId, {
								...(finalBody.text !== undefined && { text: finalBody.text }),
								...(finalBody.html !== undefined && { html: finalBody.html }),
								...(cc.length > 0 && { cc }),
								...(bcc.length > 0 && { bcc }),
								...(attachments.length > 0 && { attachments }),
							})
							.pipe(
								Effect.catchTag('EmailSendError', err =>
									Effect.gen(function* () {
										if (err.kind !== 'suppressed') {
											return yield* Effect.fail(err)
										}
										if (link.contactId) {
											yield* sql`
												UPDATE contacts
												SET email_status = 'bounced',
												    email_status_reason = ${err.message},
												    email_status_updated_at = now()
												WHERE id = ${link.contactId}
											`
										}
										return yield* new EmailSuppressed({
											contactId: link.contactId,
											recipient:
												err.recipient ?? firstRecipient(replyRecipients),
											status: 'bounced',
											reason: err.message,
										})
									}),
								),
							)

						yield* recordOutbound({
							result,
							providerInboxId: link.providerInboxId,
							localInboxId,
							companyId: link.companyId,
							contactId: link.contactId,
							subject: thread.subject ?? null,
							to: replyRecipients,
							cc,
							bcc,
							isNewThread: false,
						})

						yield* Effect.logInfo('Email reply sent').pipe(
							Effect.annotateLogs({
								event: 'email.replied',
								threadId: providerThreadId,
							}),
						)

						return result
					}),

				handleInboundWebhook: (payload: {
					provider: string
					providerInboxId: string
					providerThreadId: string
					providerMessageId: string
					from: string
					subject?: string
					classification?: InboundClassification
				}) =>
					Effect.gen(function* () {
						// Fetch the full message from the provider so we record
						// authoritative To/Cc (our inbox + anyone else on the
						// thread) rather than faking recipients from the sender.
						const providerMessage = yield* provider
							.getMessage(payload.providerInboxId, payload.providerMessageId)
							.pipe(
								Effect.catch(() =>
									Effect.succeed({
										to: [] as string[],
										cc: undefined as string[] | undefined,
									}),
								),
							)

						const existingLinks = yield* sql`
							SELECT * FROM email_thread_links
							WHERE provider_thread_id = ${payload.providerThreadId}
							LIMIT 1
						`

						let companyId: string | null = null
						let contactId: string | null = null

						if (existingLinks.length > 0) {
							const link = existingLinks[0] as {
								companyId: string | null
								contactId: string | null
							}
							companyId = link.companyId
							contactId = link.contactId
						} else {
							const contacts = yield* sql`
								SELECT c.id, c.company_id
								FROM contacts c
								WHERE c.email = ${payload.from}
								LIMIT 1
							`
							if (contacts.length > 0) {
								const contact = contacts[0] as {
									id: string
									companyId: string
								}
								contactId = contact.id
								companyId = contact.companyId
							}

							const localInboxId = yield* resolveLocalInboxId(
								payload.providerInboxId,
							)

							yield* sql`
								INSERT INTO email_thread_links ${sql.insert({
									provider: payload.provider,
									providerThreadId: payload.providerThreadId,
									providerInboxId: payload.providerInboxId,
									inboxId: localInboxId,
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
										providerThreadId: payload.providerThreadId,
										providerMessageId: payload.providerMessageId,
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
								provider: payload.provider,
								providerMessageId: payload.providerMessageId,
								providerThreadId: payload.providerThreadId,
								providerInboxId: payload.providerInboxId,
								direction: 'inbound',
								companyId,
								contactId,
								recipients: JSON.stringify({
									to: providerMessage.to,
									cc: providerMessage.cc ?? [],
									bcc: [],
								}),
								status: 'delivered',
								inboundClassification: payload.classification ?? 'normal',
								statusUpdatedAt: new Date(),
							})}
							ON CONFLICT (provider_message_id) DO NOTHING
						`

						yield* webhooks.fire('email.received', {
							threadId: payload.providerThreadId,
							messageId: payload.providerMessageId,
							from: payload.from,
							subject: payload.subject,
							companyId,
							contactId,
							classification: payload.classification ?? 'normal',
						})

						yield* Effect.logInfo('Inbound email processed').pipe(
							Effect.annotateLogs({
								event: 'email.received',
								threadId: payload.providerThreadId,
								from: payload.from,
								classification: payload.classification ?? 'normal',
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
							WHERE provider_message_id = ${messageId}
						`
						yield* sql`
							UPDATE contacts
							SET email_status = 'valid',
							    email_status_updated_at = now()
							WHERE email_status = 'unknown'
							  AND id IN (
							    SELECT contact_id FROM email_messages
							    WHERE provider_message_id = ${messageId}
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
					isHard: boolean,
					rawType: string | null,
					rawSubType: string | null,
					timestamp: Date,
				) =>
					Effect.gen(function* () {
						const newStatus = isHard ? 'bounced' : 'bounced_soft'
						const reason = rawSubType
							? `${rawType ?? ''}/${rawSubType}`
							: rawType

						yield* sql`
							UPDATE email_messages
							SET status = ${newStatus},
							    status_reason = ${reason},
							    bounce_type = ${rawType},
							    bounce_sub_type = ${rawSubType},
							    status_updated_at = ${timestamp},
							    updated_at = now()
							WHERE provider_message_id = ${messageId}
						`

						if (isHard) {
							yield* sql`
								UPDATE contacts
								SET email_status = 'bounced',
								    email_status_reason = ${reason},
								    email_status_updated_at = now()
								WHERE id IN (
								  SELECT contact_id FROM email_messages
								  WHERE provider_message_id = ${messageId}
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
								  WHERE provider_message_id = ${messageId}
								    AND contact_id IS NOT NULL
								)
							`
						}

						yield* Effect.logWarning('Email bounced').pipe(
							Effect.annotateLogs({
								event: 'email.bounced',
								messageId,
								bounceType: rawType,
								bounceSubType: rawSubType,
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
							WHERE provider_message_id = ${messageId}
						`
						yield* sql`
							UPDATE contacts
							SET email_status = 'complained',
							    email_status_reason = 'spam_complaint',
							    email_status_updated_at = now()
							WHERE id IN (
							  SELECT contact_id FROM email_messages
							  WHERE provider_message_id = ${messageId}
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
							WHERE provider_message_id = ${messageId}
						`
						yield* Effect.logWarning('Email rejected').pipe(
							Effect.annotateLogs({
								event: 'email.rejected',
								messageId,
								reason,
							}),
						)
					}),

				getThread: (threadId: string) =>
					Effect.gen(function* () {
						const links = yield* sql`
							SELECT tl.*, i.email AS inbox_email, i.display_name AS inbox_display_name, i.purpose AS inbox_purpose
							FROM email_thread_links tl
							LEFT JOIN inboxes i ON i.id = tl.inbox_id
							WHERE tl.id = ${threadId}
							LIMIT 1
						`
						if (links.length === 0) {
							return yield* new NotFound({
								entity: 'EmailThreadLink',
								id: threadId,
							})
						}
						const link = links[0] as {
							id: string
							providerInboxId: string
							providerThreadId: string
							companyId: string | null
							contactId: string | null
							subject: string | null
							status: string
							lastReadAt: Date | null
							createdAt: Date
							updatedAt: Date
							inboxEmail: string | null
							inboxDisplayName: string | null
							inboxPurpose: 'human' | 'agent' | 'shared' | null
						}

						const thread = yield* provider.getThread(
							link.providerInboxId,
							link.providerThreadId,
						)

						// Enrich messages with stored direction, classification, and
						// deliverability state. `direction` and `inbound_classification`
						// aren't part of the provider payload — they're ours.
						const storedMessages = yield* sql`
							SELECT provider_message_id, direction, inbound_classification,
							       status, status_reason, bounce_type, bounce_sub_type, status_updated_at
							FROM email_messages
							WHERE provider_thread_id = ${link.providerThreadId}
						`
						type StoredRow = {
							providerMessageId: string
							direction: 'outbound' | 'inbound'
							inboundClassification: 'normal' | 'spam' | 'blocked' | null
							status: string
							statusReason: string | null
							bounceType: string | null
							bounceSubType: string | null
							statusUpdatedAt: Date
						}
						const storedByMessageId = new Map(
							(storedMessages as Array<StoredRow>).map(m => [
								m.providerMessageId,
								m,
							]),
						)

						const enrichedMessages = thread.messages.map(m => {
							const stored = storedByMessageId.get(m.messageId) ?? null
							return {
								...m,
								direction: stored?.direction ?? 'inbound',
								inboundClassification: stored?.inboundClassification ?? null,
								deliverability: stored
									? {
											status: stored.status,
											statusReason: stored.statusReason,
											bounceType: stored.bounceType,
											bounceSubType: stored.bounceSubType,
											statusUpdatedAt: stored.statusUpdatedAt,
										}
									: null,
							}
						})

						return {
							...thread,
							messages: enrichedMessages,
							id: link.id,
							providerThreadId: link.providerThreadId,
							subject: link.subject,
							status: link.status,
							lastReadAt: link.lastReadAt,
							createdAt: link.createdAt,
							updatedAt: link.updatedAt,
							companyId: link.companyId,
							contactId: link.contactId,
							inbox:
								link.inboxEmail && link.inboxPurpose
									? {
											email: link.inboxEmail,
											displayName: link.inboxDisplayName,
											purpose: link.inboxPurpose,
										}
									: null,
						}
					}),

				updateThreadStatus: (
					threadId: string,
					status: 'open' | 'closed' | 'archived',
				) =>
					Effect.gen(function* () {
						const rows = yield* sql`
							UPDATE email_thread_links
							SET status = ${status}, updated_at = now()
							WHERE id = ${threadId}
							RETURNING id, status, updated_at
						`
						if (rows.length === 0) {
							return yield* new NotFound({
								entity: 'EmailThreadLink',
								id: threadId,
							})
						}
						return rows[0]!
					}),

				markThreadRead: (threadId: string) =>
					Effect.gen(function* () {
						yield* sql`
							UPDATE email_thread_links
							SET last_read_at = now()
							WHERE id = ${threadId}
						`
					}).pipe(Effect.orDie),

				markThreadUnread: (threadId: string) =>
					Effect.gen(function* () {
						yield* sql`
							UPDATE email_thread_links
							SET last_read_at = NULL
							WHERE id = ${threadId}
						`
					}).pipe(Effect.orDie),

				listThreads: (filters?: {
					inboxId?: string
					companyId?: string
					status?: string
					purpose?: 'human' | 'agent' | 'shared'
					query?: string
					limit?: number
					offset?: number
				}) =>
					Effect.gen(function* () {
						const limit = filters?.limit ?? 100
						const offset = filters?.offset ?? 0
						const conditions: Array<Statement.Fragment> = []
						if (filters?.inboxId)
							conditions.push(sql`tl.provider_inbox_id = ${filters.inboxId}`)
						if (filters?.companyId)
							conditions.push(sql`tl.company_id = ${filters.companyId}`)
						if (filters?.status)
							conditions.push(sql`tl.status = ${filters.status}`)
						if (filters?.purpose)
							conditions.push(sql`i.purpose = ${filters.purpose}`)
						if (filters?.query) {
							const pattern = `%${filters.query.toLowerCase()}%`
							conditions.push(sql`lower(tl.subject) LIKE ${pattern}`)
						}

						const whereClause =
							conditions.length > 0 ? sql`WHERE ${sql.and(conditions)}` : sql``

						// Single query produces items + total via window COUNT(*) OVER ().
						// Subqueries enrich each row with message counts, last-activity
						// markers, inbound classification, and unread state.
						const rows = yield* sql<{
							id: string
							providerThreadId: string
							providerInboxId: string
							companyId: string | null
							contactId: string | null
							subject: string | null
							status: string
							provider: string
							inboxId: string | null
							lastReadAt: Date | null
							createdAt: Date
							updatedAt: Date
							inboxEmail: string | null
							inboxDisplayName: string | null
							inboxPurpose: 'human' | 'agent' | 'shared' | null
							messageCount: string | number
							lastMessageAt: Date | null
							lastMessageDirection: 'inbound' | 'outbound' | null
							lastInboundAt: Date | null
							lastInboundClassification: 'normal' | 'spam' | 'blocked' | null
							isUnread: boolean
							total: string | number
						}>`
							SELECT
								tl.*,
								i.email AS inbox_email,
								i.display_name AS inbox_display_name,
								i.purpose AS inbox_purpose,
								(
									SELECT COUNT(*) FROM email_messages m
									WHERE m.provider_thread_id = tl.provider_thread_id
								) AS message_count,
								(
									SELECT MAX(m.status_updated_at) FROM email_messages m
									WHERE m.provider_thread_id = tl.provider_thread_id
								) AS last_message_at,
								(
									SELECT m.direction FROM email_messages m
									WHERE m.provider_thread_id = tl.provider_thread_id
									ORDER BY m.status_updated_at DESC
									LIMIT 1
								) AS last_message_direction,
								(
									SELECT MAX(m.status_updated_at) FROM email_messages m
									WHERE m.provider_thread_id = tl.provider_thread_id
									  AND m.direction = 'inbound'
								) AS last_inbound_at,
								(
									SELECT m.inbound_classification FROM email_messages m
									WHERE m.provider_thread_id = tl.provider_thread_id
									  AND m.direction = 'inbound'
									ORDER BY m.status_updated_at DESC
									LIMIT 1
								) AS last_inbound_classification,
								(
									(
										SELECT MAX(m.status_updated_at) FROM email_messages m
										WHERE m.provider_thread_id = tl.provider_thread_id
										  AND m.direction = 'inbound'
									) > COALESCE(tl.last_read_at, 'epoch'::timestamptz)
								) AS is_unread,
								COUNT(*) OVER () AS total
							FROM email_thread_links tl
							LEFT JOIN inboxes i ON i.id = tl.inbox_id
							${whereClause}
							ORDER BY tl.updated_at DESC
							LIMIT ${limit}
							OFFSET ${offset}
						`

						const total = rows.length > 0 ? Number(rows[0]!.total) : 0
						const items = rows.map(r => {
							const {
								total: _t,
								inboxEmail,
								inboxDisplayName,
								inboxPurpose,
								messageCount,
								...rest
							} = r
							return {
								...rest,
								messageCount: Number(messageCount),
								inbox:
									inboxEmail && inboxPurpose
										? {
												email: inboxEmail,
												displayName: inboxDisplayName,
												purpose: inboxPurpose,
											}
										: null,
							}
						})
						return { items, total, limit, offset }
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
							WHERE provider_message_id = ${messageId}
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

				// Provider-agnostic inbound attachment byte stream. The caller
				// (the REST download endpoint) pipes `stream` into the HTTP
				// response so the provider's storage is never exposed to the
				// browser directly.
				streamAttachment: (messageId: string, attachmentId: string) =>
					Effect.gen(function* () {
						const rows = yield* sql`
							SELECT provider_inbox_id
							FROM email_messages
							WHERE provider_message_id = ${messageId}
							LIMIT 1
						`
						const row = rows[0] as { providerInboxId: string } | undefined
						if (!row) {
							return yield* new NotFound({
								entity: 'EmailMessage',
								id: messageId,
							})
						}
						return yield* provider.streamAttachment(
							row.providerInboxId,
							messageId,
							attachmentId,
						)
					}),

				// ── Local inbox CRUD ──────────────────────────────────────────
				// `inboxes` is our local mirror of the provider's inbox set,
				// enriched with CRM-only metadata (purpose, owner, default flag,
				// active flag). The provider owns provider_inbox_id + email; we
				// own the rest.

				listLocalInboxes: (filters?: {
					purpose?: 'human' | 'agent' | 'shared'
					active?: boolean
					ownerUserId?: string
				}) =>
					Effect.gen(function* () {
						const conditions: Array<Statement.Fragment> = []
						if (filters?.purpose)
							conditions.push(sql`purpose = ${filters.purpose}`)
						if (filters?.active !== undefined)
							conditions.push(sql`active = ${filters.active}`)
						if (filters?.ownerUserId)
							conditions.push(sql`owner_user_id = ${filters.ownerUserId}`)
						const where =
							conditions.length > 0 ? sql`WHERE ${sql.and(conditions)}` : sql``
						return yield* sql`
							SELECT id, provider, provider_inbox_id, email, display_name,
							       purpose, owner_user_id, is_default, active, client_id,
							       created_at, updated_at
							FROM inboxes
							${where}
							ORDER BY is_default DESC, purpose, email
						`
					}).pipe(Effect.orDie),

				createInbox: (input: {
					username?: string
					domain?: string
					displayName?: string
					purpose: 'human' | 'agent' | 'shared'
					ownerUserId?: string
					isDefault?: boolean
				}) =>
					Effect.gen(function* () {
						// Client-side classification tag so the provider can
						// reverse-look up our purpose without reading our DB.
						const clientId = `forja:${input.purpose}:${
							input.ownerUserId ?? 'shared'
						}`
						const created = yield* provider.createInbox({
							...(input.username !== undefined && {
								username: input.username,
							}),
							...(input.domain !== undefined && { domain: input.domain }),
							...(input.displayName !== undefined && {
								displayName: input.displayName,
							}),
							clientId,
						})

						// If the caller asked for default, unset the current default
						// in the same purpose bucket before inserting the new row so
						// the single-default unique index doesn't trip.
						if (input.isDefault) {
							yield* sql`
								UPDATE inboxes
								SET is_default = false, updated_at = now()
								WHERE purpose = ${input.purpose} AND is_default = true
							`
						}

						const rows = yield* sql`
							INSERT INTO inboxes ${sql.insert({
								provider: providerName,
								providerInboxId: created.inboxId,
								email: created.email,
								displayName: created.displayName ?? input.displayName ?? null,
								purpose: input.purpose,
								ownerUserId: input.ownerUserId ?? null,
								isDefault: input.isDefault ?? false,
								active: true,
								clientId,
							})}
							RETURNING id, provider, provider_inbox_id, email, display_name,
							          purpose, owner_user_id, is_default, active, client_id,
							          created_at, updated_at
						`
						yield* Effect.logInfo('Inbox created').pipe(
							Effect.annotateLogs({
								event: 'inbox.created',
								email: created.email,
								purpose: input.purpose,
							}),
						)
						return rows[0]!
					}),

				updateInbox: (
					id: string,
					patch: {
						displayName?: string | null
						purpose?: 'human' | 'agent' | 'shared'
						ownerUserId?: string | null
						isDefault?: boolean
						active?: boolean
					},
				) =>
					Effect.gen(function* () {
						const sets: Array<Statement.Fragment> = []
						if (patch.displayName !== undefined)
							sets.push(sql`display_name = ${patch.displayName}`)
						if (patch.purpose !== undefined)
							sets.push(sql`purpose = ${patch.purpose}`)
						if (patch.ownerUserId !== undefined)
							sets.push(sql`owner_user_id = ${patch.ownerUserId}`)
						if (patch.isDefault !== undefined)
							sets.push(sql`is_default = ${patch.isDefault}`)
						if (patch.active !== undefined)
							sets.push(sql`active = ${patch.active}`)

						if (sets.length === 0) {
							const existing = yield* sql`
								SELECT * FROM inboxes WHERE id = ${id} LIMIT 1
							`
							if (existing.length === 0) {
								return yield* new NotFound({ entity: 'Inbox', id })
							}
							return existing[0]!
						}

						// If flipping to default, clear any other default in the
						// same purpose bucket first. We look up the row's purpose
						// (either the new one or the existing one) to scope the
						// reset correctly.
						if (patch.isDefault === true) {
							const targetPurpose =
								patch.purpose ??
								((yield* sql<{ purpose: string }>`
									SELECT purpose FROM inboxes WHERE id = ${id} LIMIT 1
								`)[0]?.purpose as 'human' | 'agent' | 'shared' | undefined)
							if (targetPurpose) {
								yield* sql`
									UPDATE inboxes
									SET is_default = false, updated_at = now()
									WHERE purpose = ${targetPurpose}
									  AND is_default = true
									  AND id <> ${id}
								`
							}
						}

						sets.push(sql`updated_at = now()`)

						const rows = yield* sql`
							UPDATE inboxes
							SET ${sql.csv(sets)}
							WHERE id = ${id}
							RETURNING id, provider, provider_inbox_id, email, display_name,
							          purpose, owner_user_id, is_default, active, client_id,
							          created_at, updated_at
						`
						if (rows.length === 0) {
							return yield* new NotFound({ entity: 'Inbox', id })
						}
						return rows[0]!
					}),

				// Reconcile the local `inboxes` table against the provider's
				// authoritative list. Rows missing upstream are inserted with
				// `purpose='shared'` by default; local rows whose provider id
				// has disappeared are marked `active=false` (we keep them so
				// historical thread links still resolve).
				syncInboxes: () =>
					Effect.gen(function* () {
						const upstream = yield* provider.listInboxes()
						const upstreamIds = new Set(upstream.map(i => i.inboxId))

						const localRows = yield* sql<{
							id: string
							providerInboxId: string
							active: boolean
						}>`
							SELECT id, provider_inbox_id, active FROM inboxes
						`
						const localByProviderId = new Map(
							localRows.map(r => [r.providerInboxId, r]),
						)

						let added = 0
						let retired = 0

						for (const up of upstream) {
							const existing = localByProviderId.get(up.inboxId)
							if (existing) {
								// Refresh denormalized email/display_name in case
								// the upstream row changed.
								yield* sql`
									UPDATE inboxes
									SET email = ${up.email},
									    display_name = ${up.displayName ?? null},
									    active = true,
									    updated_at = now()
									WHERE id = ${existing.id}
								`
							} else {
								yield* sql`
									INSERT INTO inboxes ${sql.insert({
										provider: providerName,
										providerInboxId: up.inboxId,
										email: up.email,
										displayName: up.displayName ?? null,
										purpose: 'shared',
										ownerUserId: null,
										isDefault: false,
										active: true,
										clientId: null,
									})}
								`
								added++
							}
						}

						for (const local of localRows) {
							if (!upstreamIds.has(local.providerInboxId) && local.active) {
								yield* sql`
									UPDATE inboxes
									SET active = false, updated_at = now()
									WHERE id = ${local.id}
								`
								retired++
							}
						}

						yield* Effect.logInfo('Inboxes synced').pipe(
							Effect.annotateLogs({
								event: 'inbox.synced',
								added,
								retired,
							}),
						)
						return { added, retired, total: upstream.length }
					}).pipe(Effect.orDie),

				// ── Drafts ──────────────────────────────────────────────────

				createDraft: (
					inboxId: string,
					params: CreateDraftParams,
					context?: {
						companyId?: string
						contactId?: string
						mode?: string
						threadLinkId?: string
					},
				) =>
					Effect.gen(function* () {
						const inbox = yield* resolveInbox(inboxId)
						const providerInboxId = inbox?.providerInboxId ?? inboxId
						const clientId = context ? encodeClientId(context) : undefined
						return yield* provider.createDraft(providerInboxId, {
							...params,
							...(clientId !== undefined && { clientId }),
						})
					}),

				updateDraft: (
					inboxId: string,
					draftId: string,
					params: UpdateDraftParams,
				) =>
					Effect.gen(function* () {
						const inbox = yield* resolveInbox(inboxId)
						const providerInboxId = inbox?.providerInboxId ?? inboxId
						return yield* provider.updateDraft(providerInboxId, draftId, params)
					}),

				deleteDraft: (inboxId: string, draftId: string) =>
					Effect.gen(function* () {
						const inbox = yield* resolveInbox(inboxId)
						const providerInboxId = inbox?.providerInboxId ?? inboxId
						yield* provider.deleteDraft(providerInboxId, draftId)
					}),

				getDraft: (inboxId: string, draftId: string) =>
					Effect.gen(function* () {
						const inbox = yield* resolveInbox(inboxId)
						const providerInboxId = inbox?.providerInboxId ?? inboxId
						return yield* provider.getDraft(providerInboxId, draftId)
					}),

				listDrafts: (inboxId?: string) =>
					Effect.gen(function* () {
						if (inboxId) {
							const inbox = yield* resolveInbox(inboxId)
							const providerInboxId = inbox?.providerInboxId ?? inboxId
							return yield* provider.listDrafts(providerInboxId)
						}
						const inboxes = yield* sql<{
							providerInboxId: string
						}>`
							SELECT provider_inbox_id FROM inboxes
							WHERE active = true
						`
						const results = yield* Effect.all(
							inboxes.map(i =>
								provider
									.listDrafts(i.providerInboxId)
									.pipe(
										Effect.catch(() =>
											Effect.succeed(
												[] as import('./email-provider.js').ProviderDraftItem[],
											),
										),
									),
							),
						)
						return results
							.flat()
							.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
					}).pipe(Effect.orDie),

				sendDraft: (inboxId: string, draftId: string) =>
					Effect.gen(function* () {
						const inbox = yield* resolveInbox(inboxId)
						const providerInboxId = inbox?.providerInboxId ?? inboxId
						const localInboxId = inbox?.id ?? null

						const draft = yield* provider.getDraft(providerInboxId, draftId)

						const ctx = parseClientId(draft.clientId)

						if (ctx.contactId) {
							yield* assertContactNotSuppressed(ctx.contactId, draft.to ?? [])
						}

						const result = yield* provider.sendDraft(providerInboxId, draftId)

						yield* recordOutbound({
							result,
							providerInboxId,
							localInboxId,
							companyId: ctx.companyId,
							contactId: ctx.contactId,
							subject: draft.subject ?? null,
							to: draft.to ?? [],
							cc: draft.cc ?? [],
							bcc: draft.bcc ?? [],
							isNewThread: ctx.mode !== 'reply',
						})

						yield* Effect.logInfo('Draft sent').pipe(
							Effect.annotateLogs({
								event: 'email.draft_sent',
								draftId,
								threadId: result.threadId,
							}),
						)

						return result
					}),

				// ── Footers ─────────────────────────────────────────────────

				listFooters: (inboxId: string) =>
					sql`
						SELECT * FROM inbox_footers
						WHERE inbox_id = ${inboxId}
						ORDER BY is_default DESC, name
					`.pipe(Effect.orDie),

				getFooter: (id: string) =>
					Effect.gen(function* () {
						const rows = yield* sql`
							SELECT * FROM inbox_footers
							WHERE id = ${id} LIMIT 1
						`
						if (rows.length === 0) {
							return yield* new NotFound({
								entity: 'InboxFooter',
								id,
							})
						}
						return rows[0]!
					}),

				createFooter: (input: {
					inboxId: string
					name: string
					html: string
					textFallback?: string
					isDefault?: boolean
				}) =>
					Effect.gen(function* () {
						if (input.isDefault) {
							yield* sql`
								UPDATE inbox_footers
								SET is_default = false, updated_at = now()
								WHERE inbox_id = ${input.inboxId} AND is_default = true
							`
						}
						const rows = yield* sql`
							INSERT INTO inbox_footers ${sql.insert({
								inboxId: input.inboxId,
								name: input.name,
								html: input.html,
								textFallback: input.textFallback ?? '',
								isDefault: input.isDefault ?? false,
							})}
							RETURNING *
						`
						return rows[0]!
					}),

				updateFooter: (
					id: string,
					patch: {
						name?: string
						html?: string
						textFallback?: string
						isDefault?: boolean
					},
				) =>
					Effect.gen(function* () {
						if (patch.isDefault === true) {
							const existing = yield* sql<{ inboxId: string }>`
								SELECT inbox_id FROM inbox_footers
								WHERE id = ${id} LIMIT 1
							`
							if (existing[0]) {
								yield* sql`
									UPDATE inbox_footers
									SET is_default = false, updated_at = now()
									WHERE inbox_id = ${existing[0].inboxId}
									  AND is_default = true AND id <> ${id}
								`
							}
						}
						const sets: Array<Statement.Fragment> = []
						if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`)
						if (patch.html !== undefined) sets.push(sql`html = ${patch.html}`)
						if (patch.textFallback !== undefined)
							sets.push(sql`text_fallback = ${patch.textFallback}`)
						if (patch.isDefault !== undefined)
							sets.push(sql`is_default = ${patch.isDefault}`)
						if (sets.length === 0) {
							return yield* Effect.gen(function* () {
								const r = yield* sql`
									SELECT * FROM inbox_footers WHERE id = ${id} LIMIT 1
								`
								if (r.length === 0) {
									return yield* new NotFound({
										entity: 'InboxFooter',
										id,
									})
								}
								return r[0]!
							})
						}
						sets.push(sql`updated_at = now()`)
						const rows = yield* sql`
							UPDATE inbox_footers
							SET ${sql.csv(sets)}
							WHERE id = ${id}
							RETURNING *
						`
						if (rows.length === 0) {
							return yield* new NotFound({
								entity: 'InboxFooter',
								id,
							})
						}
						return rows[0]!
					}),

				deleteFooter: (id: string) =>
					sql`DELETE FROM inbox_footers WHERE id = ${id}`.pipe(
						Effect.asVoid,
						Effect.orDie,
					),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
