import { randomUUID } from 'node:crypto'

import { Effect, Layer, ServiceMap } from 'effect'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import {
	BadRequest,
	CurrentOrg,
	EmailError,
	EmailSuppressed,
	GrantUnavailable,
	InboxInactive,
	NoDefaultInbox,
	NotFound,
	SessionContext,
} from '@batuda/controllers'
import { renderBlocks, type StagedAttachmentRef } from '@batuda/email/render'
import type { EmailBlocks } from '@batuda/email/schema'

// Standard 8-4-4-4-12 hex UUID. Used to guard service entry points that
// take a `threadId` / `companyId` / `messageId` — placeholder strings
// from the frontend (e.g. compose-form's `__unused__`) would otherwise
// propagate to postgres and surface as 500 instead of NotFound.
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

import { CalendarService } from './calendar.js'
import { CredentialCrypto } from './credential-crypto.js'
import type { ResolvedStaging, StagingRef } from './email-attachment-staging.js'
import { EmailAttachmentStaging } from './email-attachment-staging.js'
import { DraftStore } from './email-draft-store.js'
import type { SendAttachmentInput } from './email-provider.js'
import { EmailProvider } from './email-provider.js'
import type {
	DecryptedCreds,
	OutboundAttachment,
	OutboundMessage,
} from './mail-transport.js'
import { MailTransport } from './mail-transport.js'
import { StorageProvider } from './storage-provider.js'
import { EmailSent, TimelineActivityService } from './timeline-activity.js'

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
	const parts = ['batuda:draft']
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
	if (!clientId?.startsWith('batuda:draft')) return empty
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

const toStagedRefs = (
	staged: readonly ResolvedStaging[],
): readonly StagedAttachmentRef[] =>
	staged
		.filter(s => s.inline)
		.map(s => ({
			stagingId: s.stagingId,
			cid: s.cid ?? s.stagingId,
			filename: s.filename,
			contentType: s.contentType,
			inline: s.inline,
		}))

const toSendAttachments = (
	staged: readonly ResolvedStaging[],
): readonly SendAttachmentInput[] =>
	staged.map(s => ({
		filename: s.filename,
		contentType: s.contentType,
		contentBase64: s.contentBase64,
		disposition: s.inline ? 'inline' : 'attachment',
		...(s.inline && s.cid ? { contentId: s.cid } : {}),
	}))

const toOutboundAttachments = (
	atts: readonly SendAttachmentInput[],
): readonly OutboundAttachment[] =>
	atts.map(a => ({
		filename: a.filename,
		contentType: a.contentType,
		contentBase64: a.contentBase64,
		...(a.contentId !== undefined && { contentId: a.contentId }),
		...(a.disposition !== undefined && { disposition: a.disposition }),
	}))

// Outbound R2 key. The IMAP UID isn't known until the worker re-syncs the
// Sent folder, so the key shape diverges from the inbound one
// (`messages/<org>/<inbox>/<uidvalidity>/<uid>.eml`). Sanitize the
// Message-ID — nodemailer returns `<random@host>`; angle-brackets and
// any non-filename-safe glyph get folded to `_` so the path stays valid
// across S3-compatible backends.
const sentRawKey = (
	organizationId: string,
	inboxId: string,
	messageId: string,
): string => {
	const safe = messageId.replace(/[<>]/g, '').replace(/[^a-zA-Z0-9@.\-_]/g, '_')
	return `messages/${organizationId}/${inboxId}/sent/${safe}.eml`
}

const toRecipientArray = (
	value: string | readonly string[] | undefined,
): readonly string[] | undefined => {
	if (value === undefined) return undefined
	return Array.isArray(value) ? value : [value as string]
}

// DraftStore.DraftRow → the shape EmailService callers (HTTP routes + MCP
// tools) used to receive from the old EmailProvider draft surface. Keeps
// the wire format stable so the route handlers and atoms don't need to
// change in this slice.
//
// Only enumerable, non-undefined fields are emitted. The route declares
// `success: Schema.Unknown`, which decodes via `Schema.Json` whose
// `isJson` recursively rejects any value containing `undefined` —
// including object properties whose value is `undefined`. JSON.stringify
// would drop those fields silently, but the schema runs first and
// returns 500 before the stringify step. Date instances pass `isJson`
// (no enumerable keys → vacuously true) and JSON.stringify converts
// them to ISO strings on the wire, so they don't need special handling.
type DraftProviderShape = {
	readonly draftId: string
	readonly inboxId: string
	readonly to: ReadonlyArray<string>
	readonly cc: ReadonlyArray<string>
	readonly bcc: ReadonlyArray<string>
	readonly bodyJson: unknown
	readonly createdAt: Date
	readonly updatedAt: Date
	readonly clientId?: string
	readonly subject?: string
	readonly inReplyTo?: string
}
const draftRowToProviderShape = (row: {
	readonly draftId: string
	readonly inboxId: string
	readonly clientId: string | null
	readonly toAddresses: ReadonlyArray<string>
	readonly ccAddresses: ReadonlyArray<string>
	readonly bccAddresses: ReadonlyArray<string>
	readonly subject: string | null
	readonly inReplyTo: string | null
	readonly bodyJson: unknown
	readonly createdAt: Date
	readonly updatedAt: Date
}): DraftProviderShape => ({
	draftId: row.draftId,
	inboxId: row.inboxId,
	to: row.toAddresses,
	cc: row.ccAddresses,
	bcc: row.bccAddresses,
	bodyJson: row.bodyJson,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
	...(row.clientId !== null && { clientId: row.clientId }),
	...(row.subject !== null && { subject: row.subject }),
	...(row.inReplyTo !== null && { inReplyTo: row.inReplyTo }),
})

// Strip server-internal fields from the attachments JSONB before a row
// crosses the API boundary. The DB column carries `storageKey` (where the
// bytes live in object storage) — that's a worker-implementation detail
// the client must not see. The wire shape matches AttachmentMeta in
// apps/internal/src/routes/emails/$threadId.tsx: attachmentId is the
// JSONB array index as a string so the download URL resolves back via
// EmailService.streamAttachment.
const projectAttachmentsForWire = <T extends Record<string, unknown>>(
	row: T,
): T => {
	const raw = row['attachments']
	if (!Array.isArray(raw)) return row
	const projected = raw.map(a => {
		const r = a as Record<string, unknown>
		return {
			attachmentId: String(r['index'] ?? ''),
			filename: r['filename'],
			size: r['sizeBytes'],
			contentType: r['contentType'],
			cid: r['cid'],
			isInline: r['isInline'],
		}
	})
	return { ...row, attachments: projected }
}

// Vendor-neutral mailbox presets surfaced to the connect-mailbox UI. Adding a
// new entry requires no code beyond appending to this list — fields are the
// same shape as the createInbox payload.
const PROVIDER_PRESETS = [
	{
		name: 'Infomaniak',
		imapHost: 'mail.infomaniak.com',
		imapPort: 993,
		imapSecurity: 'tls',
		smtpHost: 'mail.infomaniak.com',
		smtpPort: 465,
		smtpSecurity: 'tls',
		helpUrl: 'https://www.infomaniak.com/en/support/faq/2427',
	},
	{
		name: 'Fastmail',
		imapHost: 'imap.fastmail.com',
		imapPort: 993,
		imapSecurity: 'tls',
		smtpHost: 'smtp.fastmail.com',
		smtpPort: 465,
		smtpSecurity: 'tls',
		helpUrl: 'https://www.fastmail.help/hc/en-us/articles/1500000278342',
	},
	{
		name: 'Gmail Workspace',
		imapHost: 'imap.gmail.com',
		imapPort: 993,
		imapSecurity: 'tls',
		smtpHost: 'smtp.gmail.com',
		smtpPort: 465,
		smtpSecurity: 'tls',
		helpUrl: 'https://support.google.com/mail/answer/7126229',
	},
	{
		name: 'Microsoft 365',
		imapHost: 'outlook.office365.com',
		imapPort: 993,
		imapSecurity: 'tls',
		smtpHost: 'smtp.office365.com',
		smtpPort: 587,
		smtpSecurity: 'starttls',
		helpUrl:
			'https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-8361e398-8af4-4e97-b147-6c6c4ac95353',
	},
	{
		name: 'Proton Bridge',
		imapHost: '127.0.0.1',
		imapPort: 1143,
		imapSecurity: 'starttls',
		smtpHost: '127.0.0.1',
		smtpPort: 1025,
		smtpSecurity: 'starttls',
		helpUrl: 'https://proton.me/support/protonmail-bridge-clients',
	},
	{
		name: 'Generic IMAP',
		imapHost: '',
		imapPort: 993,
		imapSecurity: 'tls',
		smtpHost: '',
		smtpPort: 587,
		smtpSecurity: 'starttls',
		helpUrl: '',
	},
] as const

type InboxRow = {
	id: string
	organizationId: string
	email: string
	displayName: string | null
	purpose: 'human' | 'agent' | 'shared'
	ownerUserId: string | null
	isDefault: boolean
	isPrivate: boolean
	active: boolean
	imapHost: string
	imapPort: number
	imapSecurity: 'tls' | 'starttls' | 'plain'
	smtpHost: string
	smtpPort: number
	smtpSecurity: 'tls' | 'starttls' | 'plain'
	username: string
	grantStatus: 'connected' | 'auth_failed' | 'connect_failed' | 'disabled'
	grantLastError: string | null
	grantLastSeenAt: Date | null
	createdAt: Date
	updatedAt: Date
}

export class EmailService extends ServiceMap.Service<EmailService>()(
	'EmailService',
	{
		make: Effect.gen(function* () {
			const provider = yield* EmailProvider
			const sql = yield* SqlClient.SqlClient
			const timeline = yield* TimelineActivityService
			const staging = yield* EmailAttachmentStaging
			const drafts = yield* DraftStore
			const calendar = yield* CalendarService
			const crypto = yield* CredentialCrypto
			const transport = yield* MailTransport
			const storage = yield* StorageProvider
			void calendar // calendar handoff lives in mail-worker; kept as a dep so the
			//             service stays compatible when worker integration lands.

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

			// ── Inbox lookups (org-scoped) ────────────────────────────────
			//
			// Every inbox read narrows by the active organization id so a
			// caller cannot accidentally (or deliberately) reach across orgs
			// even if the planner skips the RLS policy.

			const selectInboxColumns = sql`
				id, organization_id, email, display_name, purpose, owner_user_id,
				is_default, is_private, active, imap_host, imap_port, imap_security,
				smtp_host, smtp_port, smtp_security, username,
				grant_status, grant_last_error, grant_last_seen_at,
				created_at, updated_at
			`

			const resolveInbox = (inboxId: string) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const rows = yield* sql<InboxRow>`
						SELECT ${selectInboxColumns} FROM inboxes
						WHERE id = ${inboxId}
						  AND organization_id = ${currentOrg.id}
						LIMIT 1
					`.pipe(Effect.orDie)
					return rows[0] ?? null
				})

			const resolveDefaultInboxForCurrentUser = () =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const session = yield* SessionContext
					const rows = yield* sql<InboxRow>`
						SELECT ${selectInboxColumns} FROM inboxes
						WHERE organization_id = ${currentOrg.id}
						  AND owner_user_id = ${session.userId}
						  AND purpose = 'human'
						  AND is_default = true
						  AND active = true
						LIMIT 1
					`.pipe(Effect.orDie)
					const row = rows[0]
					if (!row) {
						return yield* new NoDefaultInbox({
							message:
								'No primary inbox configured. Connect a mailbox in Settings → Email.',
						})
					}
					return row
				})

			// Single guard used before every send/reply so the inbox-state
			// failure modes (deactivated row, broken IMAP/SMTP credentials) all
			// raise the same tagged errors the route maps to 409s.
			const assertInboxUsable = (inbox: InboxRow) =>
				Effect.gen(function* () {
					if (!inbox.active) {
						return yield* new InboxInactive({ inboxId: inbox.id })
					}
					if (inbox.grantStatus !== 'connected') {
						return yield* new GrantUnavailable({
							inboxId: inbox.id,
							grantStatus: inbox.grantStatus,
						})
					}
				})

			type FooterRow = { bodyJson: EmailBlocks }
			const resolveDefaultFooter = (inboxId: string) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const rows = yield* sql<FooterRow>`
						SELECT body_json FROM inbox_footers
						WHERE inbox_id = ${inboxId}
						  AND organization_id = ${currentOrg.id}
						  AND is_default = true
						LIMIT 1
					`.pipe(Effect.orDie)
					return rows[0]?.bodyJson ?? null
				})

			type ParticipantRow = {
				emailMessageId: string
				emailAddress: string
				displayName: string | null
				role: 'from' | 'to' | 'cc' | 'bcc'
				contactId: string | null
			}

			const buildParticipants = (
				emailMessageId: string,
				fromAddress: string | null,
				to: readonly string[],
				cc: readonly string[],
				bcc: readonly string[],
			): ParticipantRow[] => {
				const rows: ParticipantRow[] = []
				const push = (address: string, role: 'from' | 'to' | 'cc' | 'bcc') => {
					const trimmed = address.trim()
					if (!trimmed) return
					rows.push({
						emailMessageId,
						emailAddress: trimmed.toLowerCase(),
						displayName: null,
						role,
						contactId: null,
					})
				}
				if (fromAddress) push(fromAddress, 'from')
				for (const a of to) push(a, 'to')
				for (const a of cc) push(a, 'cc')
				for (const a of bcc) push(a, 'bcc')
				return rows
			}

			// Pull the encrypted credential blob for an inbox and decrypt it
			// in-process. Plaintext stays in memory only for the duration of
			// the SMTP send + IMAP APPEND below; never logged, never returned.
			const loadDecryptedCreds = (
				inbox: InboxRow,
			): Effect.Effect<DecryptedCreds, never, never> =>
				Effect.gen(function* () {
					const credRows = yield* sql<{
						passwordCiphertext: Uint8Array
						passwordNonce: Uint8Array
						passwordTag: Uint8Array
					}>`
						SELECT
							password_ciphertext AS "passwordCiphertext",
							password_nonce      AS "passwordNonce",
							password_tag        AS "passwordTag"
						FROM inboxes
						WHERE id = ${inbox.id}
						LIMIT 1
					`.pipe(Effect.orDie)
					const cred = credRows[0]
					if (!cred) {
						return yield* Effect.die(
							new Error(
								`inbox ${inbox.id} disappeared between resolve and send`,
							),
						)
					}
					const password = crypto.decryptPassword({
						inboxId: inbox.id,
						ciphertext: cred.passwordCiphertext,
						nonce: cred.passwordNonce,
						tag: cred.passwordTag,
					})
					return {
						inboxId: inbox.id,
						imapHost: inbox.imapHost,
						imapPort: inbox.imapPort,
						imapSecurity: inbox.imapSecurity,
						smtpHost: inbox.smtpHost,
						smtpPort: inbox.smtpPort,
						smtpSecurity: inbox.smtpSecurity,
						username: inbox.username,
						password,
					}
				})

			// SMTP-send via the transport, persist the wire bytes in object
			// storage, and best-effort APPEND to the user's "Sent" folder so
			// the provider-side mailbox mirrors what we shipped. The APPEND
			// is best-effort because some providers (Gmail, M365) auto-copy
			// outbound to Sent and a duplicate would make the worker's next
			// IDLE tick churn — `idx_email_messages_msgid` would dedupe but
			// we save the round trip when we know the provider already did
			// it. APPEND failures land in the log; the row stays canonical.
			const dispatchOutbound = (
				inbox: InboxRow,
				message: OutboundMessage,
			): Effect.Effect<{ messageId: string; rawRef: string }, never, never> =>
				Effect.gen(function* () {
					const creds = yield* loadDecryptedCreds(inbox)
					const sent = yield* transport.send(creds, message).pipe(Effect.orDie)
					const messageId = sent.messageId
					const key = sentRawKey(inbox.organizationId, inbox.id, messageId)
					yield* storage
						.put({ key, body: sent.raw, contentType: 'message/rfc822' })
						.pipe(
							Effect.catchCause(cause =>
								Effect.logWarning(
									`outbound raw upload failed inbox=${inbox.id} key=${key}`,
								).pipe(Effect.andThen(Effect.logError(cause))),
							),
						)
					yield* transport
						.appendToSent(creds, sent.raw)
						.pipe(
							Effect.catchCause(cause =>
								Effect.logWarning(
									`appendToSent failed inbox=${inbox.id} (provider may auto-copy)`,
								).pipe(Effect.andThen(Effect.logError(cause))),
							),
						)
					return { messageId, rawRef: key }
				})

			// `result.threadId` is the RFC 5322 Message-ID of the thread root.
			// For new threads we INSERT a thread-link row keyed on that id;
			// for replies the existing row is reused and `references` is
			// extended with the root id so downstream queries can pivot from
			// any reply back to the thread. `rawRfc822Ref` is the object-
			// storage key that holds the wire bytes — set by `dispatchOutbound`.
			const recordOutbound = (args: {
				result: { messageId: string; threadId: string }
				inbox: InboxRow
				companyId: string | null
				contactId: string | null
				subject: string | null
				to: string[]
				cc: string[]
				bcc: string[]
				existingThreadLink: {
					id: string
					externalThreadId: string
				} | null
				rawRfc822Ref: string
			}) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg

					yield* sql.withTransaction(
						Effect.gen(function* () {
							let externalThreadId: string
							let inReplyTo: string | null
							let referencesArr: string[]

							if (args.existingThreadLink) {
								// Reply: reuse the link's root id, append it to References.
								externalThreadId = args.existingThreadLink.externalThreadId
								inReplyTo = args.existingThreadLink.externalThreadId
								referencesArr = [args.existingThreadLink.externalThreadId]
							} else {
								// Brand-new thread: provider's threadId IS the root msg id.
								externalThreadId = args.result.threadId
								inReplyTo = null
								referencesArr = []
								yield* sql`
									INSERT INTO email_thread_links ${sql.insert({
										organizationId: currentOrg.id,
										externalThreadId,
										inboxId: args.inbox.id,
										companyId: args.companyId,
										contactId: args.contactId,
										subject: args.subject,
										status: 'open',
									})}
								`
							}

							const sentAt = new Date()
							const emailRows = yield* sql<{ id: string }>`
								INSERT INTO email_messages ${sql.insert({
									organizationId: currentOrg.id,
									inboxId: args.inbox.id,
									messageId: args.result.messageId,
									inReplyTo,
									references: referencesArr,
									direction: 'outbound',
									folder: 'Sent',
									imapUid: null,
									imapUidvalidity: null,
									rawRfc822Ref: args.rawRfc822Ref,
									subject: args.subject,
									receivedAt: sentAt,
									textPreview: null,
									textBody: null,
									htmlBody: null,
									companyId: args.companyId,
									contactId: args.contactId,
									recipients: JSON.stringify({
										to: args.to,
										cc: args.cc,
										bcc: args.bcc,
									}),
									status: 'normal',
									statusReason: null,
									bounceType: null,
									bounceSubType: null,
									inboundClassification: null,
									statusUpdatedAt: sentAt,
								})} RETURNING id
							`
							const [emailMessage] = emailRows
							if (!emailMessage) {
								return yield* Effect.die(
									new Error(
										'INSERT INTO email_messages RETURNING id yielded no row',
									),
								)
							}

							const participants = buildParticipants(
								emailMessage.id,
								args.inbox.email,
								args.to,
								args.cc,
								args.bcc,
							)
							if (participants.length > 0) {
								yield* sql`
									INSERT INTO message_participants ${sql.insert(participants)}
								`
							}

							if (args.companyId) {
								yield* timeline.record(
									new EmailSent({
										emailMessageId: emailMessage.id,
										companyId: args.companyId,
										contactId: args.contactId,
										subject: args.subject,
										summary: null,
										actorUserId: null,
										occurredAt: sentAt,
									}),
								)
							}
						}),
					)
				})

			return {
				send: (
					inboxId: string | undefined,
					to: string | string[],
					subject: string,
					bodyJson: EmailBlocks,
					companyId: string,
					contactId?: string,
					extras?: {
						cc?: string[] | undefined
						bcc?: string[] | undefined
						replyTo?: string | undefined
						preview?: string | undefined
						attachmentRefs?: readonly StagingRef[] | undefined
						rawAttachments?: readonly SendAttachmentInput[] | undefined
						skipFooter?: boolean | undefined
					},
				) =>
					Effect.gen(function* () {
						const cc = extras?.cc ?? []
						const bcc = extras?.bcc ?? []
						const attachmentRefs = extras?.attachmentRefs ?? []
						const rawAttachments = extras?.rawAttachments ?? []

						// Resolve to the calling member's primary human inbox when no
						// id is supplied — the contract for /v1/email/send.
						const inbox = inboxId
							? yield* resolveInbox(inboxId).pipe(
									Effect.flatMap(row =>
										row
											? Effect.succeed(row)
											: Effect.fail(new InboxInactive({ inboxId })),
									),
								)
							: yield* resolveDefaultInboxForCurrentUser()
						yield* assertInboxUsable(inbox)

						if (contactId) {
							yield* assertContactNotSuppressed(contactId, to)
						}

						const staged = yield* staging.resolve(inbox.id, attachmentRefs)
						let blocks: EmailBlocks = bodyJson
						if (!extras?.skipFooter) {
							const footerBlocks = yield* resolveDefaultFooter(inbox.id)
							if (footerBlocks) blocks = [...bodyJson, ...footerBlocks]
						}
						const rendered = yield* Effect.tryPromise({
							try: () =>
								renderBlocks(blocks, {
									...(extras?.preview !== undefined && {
										preview: extras.preview,
									}),
									attachments: toStagedRefs(staged),
								}),
							catch: err =>
								new EmailError({
									message: `renderBlocks: ${err instanceof Error ? err.message : String(err)}`,
								}),
						})
						const sendAttachments = [
							...toSendAttachments(staged),
							...rawAttachments,
						]
						const toList = Array.isArray(to) ? to : [to]

						const outbound: OutboundMessage = {
							from: inbox.email,
							to: toList,
							subject,
							text: rendered.text,
							html: rendered.html,
							...(cc.length > 0 && { cc }),
							...(bcc.length > 0 && { bcc }),
							...(extras?.replyTo !== undefined && {
								replyTo: toRecipientArray(extras.replyTo),
							}),
							...(sendAttachments.length > 0 && {
								attachments: toOutboundAttachments(sendAttachments),
							}),
						}

						const dispatched = yield* dispatchOutbound(inbox, outbound)
						// Outbound start-of-thread: the SMTP-assigned Message-ID
						// becomes the canonical thread root id. Replies will reuse
						// it via In-Reply-To / References.
						const result = {
							messageId: dispatched.messageId,
							threadId: dispatched.messageId,
						}

						yield* recordOutbound({
							result,
							inbox,
							companyId,
							contactId: contactId ?? null,
							subject,
							to: toList,
							cc,
							bcc,
							existingThreadLink: null,
							rawRfc822Ref: dispatched.rawRef,
						})

						if (staged.length > 0) {
							yield* staging
								.markSentAndCleanup(staged.map(s => s.stagingId))
								.pipe(Effect.ignore)
						}

						yield* Effect.logInfo('Email sent').pipe(
							Effect.annotateLogs({
								event: 'email.sent',
								companyId,
								threadId: result.threadId,
							}),
						)

						return result
					}),

				// `threadId` is the local `email_thread_links.id` (UUID); the
				// service hops from there to the inbox + the most recent
				// message's RFC Message-ID, which is what the provider needs
				// to thread a reply.
				reply: (
					threadId: string,
					bodyJson: EmailBlocks,
					extras?: {
						cc?: string[] | undefined
						bcc?: string[] | undefined
						preview?: string | undefined
						attachmentRefs?: readonly StagingRef[] | undefined
						rawAttachments?: readonly SendAttachmentInput[] | undefined
						skipFooter?: boolean | undefined
					},
				) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const cc = extras?.cc ?? []
						const bcc = extras?.bcc ?? []
						const attachmentRefs = extras?.attachmentRefs ?? []
						const rawAttachments = extras?.rawAttachments ?? []

						const links = yield* sql<{
							id: string
							externalThreadId: string
							inboxId: string | null
							companyId: string | null
							contactId: string | null
							subject: string | null
						}>`
							SELECT id, external_thread_id, inbox_id, company_id, contact_id, subject
							FROM email_thread_links
							WHERE id = ${threadId}
							  AND organization_id = ${currentOrg.id}
							LIMIT 1
						`.pipe(Effect.orDie)
						if (links.length === 0) {
							return yield* new NotFound({
								entity: 'EmailThreadLink',
								id: threadId,
							})
						}
						const link = links[0]!

						if (!link.inboxId) {
							return yield* new InboxInactive({ inboxId: link.id })
						}

						const inbox = yield* resolveInbox(link.inboxId).pipe(
							Effect.flatMap(row =>
								row
									? Effect.succeed(row)
									: Effect.fail(new InboxInactive({ inboxId: link.inboxId! })),
							),
						)
						yield* assertInboxUsable(inbox)

						// Most recent message in the thread anchors the reply. We
						// match on `message_id = external_thread_id` (root) OR
						// `external_thread_id = ANY(references)` (any reply).
						const lastMessages = yield* sql<{
							messageId: string
							recipients: { from?: string; to?: string[] }
						}>`
							SELECT message_id, recipients
							FROM email_messages
							WHERE organization_id = ${currentOrg.id}
							  AND (
							    message_id = ${link.externalThreadId}
							    OR ${link.externalThreadId} = ANY("references")
							  )
							ORDER BY received_at DESC NULLS LAST, status_updated_at DESC
							LIMIT 1
						`.pipe(Effect.orDie)
						const lastMessage = lastMessages[0]
						if (!lastMessage) {
							return yield* new EmailError({
								message: `Thread ${threadId} has no messages`,
							})
						}

						// The reply addressee list is whatever sat on the most recent
						// inbound. For now we keep it conservative (anyone listed in the
						// recipients snapshot's `to`); refining once mail-worker stores
						// parsed From/To/Cc separately.
						const replyRecipients = lastMessage.recipients?.to ?? []

						if (link.contactId) {
							yield* assertContactNotSuppressed(link.contactId, replyRecipients)
						}

						const staged = yield* staging.resolve(inbox.id, attachmentRefs)
						let blocks: EmailBlocks = bodyJson
						if (!extras?.skipFooter) {
							const footerBlocks = yield* resolveDefaultFooter(inbox.id)
							if (footerBlocks) blocks = [...bodyJson, ...footerBlocks]
						}
						const rendered = yield* Effect.tryPromise({
							try: () =>
								renderBlocks(blocks, {
									...(extras?.preview !== undefined && {
										preview: extras.preview,
									}),
									attachments: toStagedRefs(staged),
								}),
							catch: err =>
								new EmailError({
									message: `renderBlocks: ${err instanceof Error ? err.message : String(err)}`,
								}),
						})
						const sendAttachments = [
							...toSendAttachments(staged),
							...rawAttachments,
						]

						// Subject convention: "Re:" prefix on first reply, leave alone
						// thereafter (matches MUA defaults). Empty subject is allowed
						// — providers will accept it.
						const replySubject = link.subject
							? link.subject.startsWith('Re:') ||
								link.subject.toLowerCase().startsWith('re:')
								? link.subject
								: `Re: ${link.subject}`
							: ''

						const outbound: OutboundMessage = {
							from: inbox.email,
							to: replyRecipients,
							subject: replySubject,
							text: rendered.text,
							html: rendered.html,
							...(cc.length > 0 && { cc }),
							...(bcc.length > 0 && { bcc }),
							inReplyTo: lastMessage.messageId,
							references: [link.externalThreadId, lastMessage.messageId].filter(
								(value, idx, arr) => arr.indexOf(value) === idx,
							),
							...(sendAttachments.length > 0 && {
								attachments: toOutboundAttachments(sendAttachments),
							}),
						}

						const dispatched = yield* dispatchOutbound(inbox, outbound)
						const result = {
							messageId: dispatched.messageId,
							threadId: link.externalThreadId,
						}

						yield* recordOutbound({
							result,
							inbox,
							companyId: link.companyId,
							contactId: link.contactId,
							subject: link.subject,
							to: replyRecipients,
							cc,
							bcc,
							existingThreadLink: {
								id: link.id,
								externalThreadId: link.externalThreadId,
							},
							rawRfc822Ref: dispatched.rawRef,
						})

						if (staged.length > 0) {
							yield* staging
								.markSentAndCleanup(staged.map(s => s.stagingId))
								.pipe(Effect.ignore)
						}

						yield* Effect.logInfo('Email reply sent').pipe(
							Effect.annotateLogs({
								event: 'email.replied',
								threadId,
							}),
						)

						return result
					}),

				getThread: (threadId: string) =>
					Effect.gen(function* () {
						// Front-end placeholders ('__unused__' from compose-form,
						// stale URLs, typos) reach here as raw strings. Guard up
						// front so postgres' UUID parser never throws — that
						// surfaces as Effect.die → 500, masking what is really
						// a NotFound at the resource level.
						if (!UUID_PATTERN.test(threadId)) {
							return yield* new NotFound({
								entity: 'EmailThread',
								id: threadId,
							})
						}
						const currentOrg = yield* CurrentOrg
						const session = yield* SessionContext

						const links = yield* sql<{
							id: string
							externalThreadId: string
							inboxId: string | null
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
							inboxIsPrivate: boolean | null
							inboxOwnerUserId: string | null
						}>`
							SELECT
								tl.id,
								tl.external_thread_id,
								tl.inbox_id,
								tl.company_id,
								tl.contact_id,
								tl.subject,
								tl.status,
								tl.last_read_at,
								tl.created_at,
								tl.updated_at,
								i.email AS inbox_email,
								i.display_name AS inbox_display_name,
								i.purpose AS inbox_purpose,
								i.is_private AS inbox_is_private,
								i.owner_user_id AS inbox_owner_user_id
							FROM email_thread_links tl
							LEFT JOIN inboxes i ON i.id = tl.inbox_id
							WHERE tl.id = ${threadId}
							  AND tl.organization_id = ${currentOrg.id}
							LIMIT 1
						`.pipe(Effect.orDie)
						if (links.length === 0) {
							return yield* new NotFound({
								entity: 'EmailThreadLink',
								id: threadId,
							})
						}
						const link = links[0]!

						// Privacy gate: a thread anchored to a private inbox is
						// invisible to anyone other than its owner. Surfaced as
						// NotFound so org-mates cannot enumerate private inboxes
						// by trial-and-error.
						if (
							link.inboxIsPrivate === true &&
							link.inboxOwnerUserId !== session.userId
						) {
							return yield* new NotFound({
								entity: 'EmailThreadLink',
								id: threadId,
							})
						}

						const messages = yield* sql<{
							id: string
							messageId: string
							inReplyTo: string | null
							references: string[] | null
							direction: 'inbound' | 'outbound'
							folder: string
							subject: string | null
							receivedAt: Date | null
							textPreview: string | null
							textBody: string | null
							htmlBody: string | null
							recipients: { to?: string[]; cc?: string[]; bcc?: string[] }
							attachments: ReadonlyArray<{
								index: number
								filename: string
								contentType: string
								sizeBytes: number
								cid: string | null
								isInline: boolean
								storageKey: string
							}>
							status: 'normal' | 'spam' | 'blocked' | 'bounced'
							statusReason: string | null
							bounceType: string | null
							bounceSubType: string | null
							inboundClassification: 'normal' | 'spam' | 'blocked' | null
							statusUpdatedAt: Date
						}>`
							SELECT id, message_id, in_reply_to, "references",
							       direction, folder, subject, received_at,
							       text_preview, text_body, html_body, recipients,
							       attachments,
							       status, status_reason, bounce_type, bounce_sub_type,
							       inbound_classification, status_updated_at
							FROM email_messages
							WHERE organization_id = ${currentOrg.id}
							  AND (
							    message_id = ${link.externalThreadId}
							    OR ${link.externalThreadId} = ANY("references")
							  )
							ORDER BY received_at ASC NULLS LAST, status_updated_at ASC
						`.pipe(Effect.orDie)

						const messagesOut = messages.map(m =>
							projectAttachmentsForWire(
								m as unknown as Record<string, unknown>,
							),
						)

						return {
							id: link.id,
							externalThreadId: link.externalThreadId,
							subject: link.subject,
							status: link.status,
							lastReadAt: link.lastReadAt,
							createdAt: link.createdAt,
							updatedAt: link.updatedAt,
							companyId: link.companyId,
							contactId: link.contactId,
							messages: messagesOut,
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
						const currentOrg = yield* CurrentOrg
						const rows = yield* sql`
							UPDATE email_thread_links
							SET status = ${status}, updated_at = now()
							WHERE id = ${threadId}
							  AND organization_id = ${currentOrg.id}
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
						const currentOrg = yield* CurrentOrg
						yield* sql`
							UPDATE email_thread_links
							SET last_read_at = now()
							WHERE id = ${threadId}
							  AND organization_id = ${currentOrg.id}
						`
					}).pipe(Effect.orDie),

				markThreadUnread: (threadId: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						yield* sql`
							UPDATE email_thread_links
							SET last_read_at = NULL
							WHERE id = ${threadId}
							  AND organization_id = ${currentOrg.id}
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
						const currentOrg = yield* CurrentOrg
						const session = yield* SessionContext

						const limit = filters?.limit ?? 100
						const offset = filters?.offset ?? 0
						const conditions: Array<Statement.Fragment> = [
							sql`tl.organization_id = ${currentOrg.id}`,
							// Privacy gate: a private inbox is hidden from anyone
							// other than its owner. Phrased as a join-side filter so
							// thread rows that have NO inbox (legacy / inbox deleted)
							// stay visible to whoever was already on the thread.
							sql`(i.id IS NULL OR i.is_private = false OR i.owner_user_id = ${session.userId})`,
						]
						if (filters?.inboxId)
							conditions.push(sql`tl.inbox_id = ${filters.inboxId}`)
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

						const whereClause = sql`WHERE ${sql.and(conditions)}`

						// Window COUNT(*) OVER () gives total in the same scan; the
						// per-thread sub-selects pivot on external_thread_id (the
						// column the threading index lives on) so each row stays a
						// constant-cost lookup.
						const rows = yield* sql<{
							id: string
							externalThreadId: string
							inboxId: string | null
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
							messageCount: string | number
							lastMessageAt: Date | null
							lastMessageDirection: 'inbound' | 'outbound' | null
							lastInboundAt: Date | null
							lastInboundClassification: 'normal' | 'spam' | 'blocked' | null
							isUnread: boolean
							total: string | number
						}>`
							SELECT
								tl.id,
								tl.external_thread_id,
								tl.inbox_id,
								tl.company_id,
								tl.contact_id,
								tl.subject,
								tl.status,
								tl.last_read_at,
								tl.created_at,
								tl.updated_at,
								i.email AS inbox_email,
								i.display_name AS inbox_display_name,
								i.purpose AS inbox_purpose,
								(
									SELECT COUNT(*) FROM email_messages m
									WHERE m.organization_id = tl.organization_id
									  AND (m.message_id = tl.external_thread_id
									       OR tl.external_thread_id = ANY(m."references"))
								) AS message_count,
								(
									SELECT MAX(m.status_updated_at) FROM email_messages m
									WHERE m.organization_id = tl.organization_id
									  AND (m.message_id = tl.external_thread_id
									       OR tl.external_thread_id = ANY(m."references"))
								) AS last_message_at,
								(
									SELECT m.direction FROM email_messages m
									WHERE m.organization_id = tl.organization_id
									  AND (m.message_id = tl.external_thread_id
									       OR tl.external_thread_id = ANY(m."references"))
									ORDER BY m.status_updated_at DESC
									LIMIT 1
								) AS last_message_direction,
								(
									SELECT MAX(m.status_updated_at) FROM email_messages m
									WHERE m.organization_id = tl.organization_id
									  AND (m.message_id = tl.external_thread_id
									       OR tl.external_thread_id = ANY(m."references"))
									  AND m.direction = 'inbound'
								) AS last_inbound_at,
								(
									SELECT m.inbound_classification FROM email_messages m
									WHERE m.organization_id = tl.organization_id
									  AND (m.message_id = tl.external_thread_id
									       OR tl.external_thread_id = ANY(m."references"))
									  AND m.direction = 'inbound'
									ORDER BY m.status_updated_at DESC
									LIMIT 1
								) AS last_inbound_classification,
								(
									(
										SELECT MAX(m.status_updated_at) FROM email_messages m
										WHERE m.organization_id = tl.organization_id
										  AND (m.message_id = tl.external_thread_id
										       OR tl.external_thread_id = ANY(m."references"))
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
						const currentOrg = yield* CurrentOrg
						const conditions: Array<Statement.Fragment> = [
							sql`organization_id = ${currentOrg.id}`,
						]
						if (filters?.contactId)
							conditions.push(sql`contact_id = ${filters.contactId}`)
						if (filters?.companyId)
							conditions.push(sql`company_id = ${filters.companyId}`)
						if (filters?.status)
							conditions.push(sql`status = ${filters.status}`)

						const rows = yield* sql`
							SELECT * FROM email_messages
							WHERE ${sql.and(conditions)}
							ORDER BY status_updated_at DESC
							LIMIT ${filters?.limit ?? 50}
							OFFSET ${filters?.offset ?? 0}
						`
						return rows.map(r => projectAttachmentsForWire(r))
					}).pipe(Effect.orDie),

				// `messageId` may be either the local UUID PK or the RFC Message-ID;
				// the route exposes the RFC value so the second WHERE is the hot
				// path. Either matches the unique (organization_id, message_id)
				// index.
				getMessage: (messageId: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const rows = yield* sql`
							SELECT * FROM email_messages
							WHERE organization_id = ${currentOrg.id}
							  AND (id::text = ${messageId} OR message_id = ${messageId})
							LIMIT 1
						`
						if (rows.length === 0) {
							return yield* new NotFound({
								entity: 'EmailMessage',
								id: messageId,
							})
						}
						return projectAttachmentsForWire(rows[0] as Record<string, unknown>)
					}),

				// ── Inbox CRUD ────────────────────────────────────────────────

				listProviderPresets: () => Effect.succeed(PROVIDER_PRESETS),

				listLocalInboxes: (filters?: {
					purpose?: 'human' | 'agent' | 'shared'
					active?: boolean
					ownerUserId?: string
				}) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const session = yield* SessionContext
						const conditions: Array<Statement.Fragment> = [
							sql`organization_id = ${currentOrg.id}`,
							// Same privacy gate as listThreads — own private inboxes
							// always show; others' never do.
							sql`(is_private = false OR owner_user_id = ${session.userId})`,
						]
						if (filters?.purpose)
							conditions.push(sql`purpose = ${filters.purpose}`)
						if (filters?.active !== undefined)
							conditions.push(sql`active = ${filters.active}`)
						if (filters?.ownerUserId)
							conditions.push(sql`owner_user_id = ${filters.ownerUserId}`)
						return yield* sql`
							SELECT ${selectInboxColumns}
							FROM inboxes
							WHERE ${sql.and(conditions)}
							ORDER BY is_default DESC, purpose, email
						`
					}).pipe(Effect.orDie),

				inboxStatus: () =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const session = yield* SessionContext
						const rows = yield* sql<{ id: string; email: string }>`
							SELECT id, email FROM inboxes
							WHERE organization_id = ${currentOrg.id}
							  AND owner_user_id = ${session.userId}
							  AND purpose = 'human'
							  AND is_default = true
							  AND active = true
							LIMIT 1
						`.pipe(Effect.orDie)
						const row = rows[0]
						if (!row) {
							return { hasDefault: false, primary: null as null }
						}
						return {
							hasDefault: true,
							primary: { inboxId: row.id, email: row.email },
						}
					}),

				createInbox: (input: {
					email: string
					displayName?: string | undefined
					purpose: 'human' | 'agent' | 'shared'
					ownerUserId?: string | undefined
					isPrivate?: boolean | undefined
					isDefault?: boolean | undefined
					imapHost: string
					imapPort: number
					imapSecurity: 'tls' | 'starttls' | 'plain'
					smtpHost: string
					smtpPort: number
					smtpSecurity: 'tls' | 'starttls' | 'plain'
					username: string
					password: string
				}) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const session = yield* SessionContext

						// purpose CHECK constraint demands an owner for human/agent
						// and forbids one for shared. Default to the caller for
						// human inboxes when ownerUserId is omitted; reject the
						// shared+owner mismatch up-front so the DB error stays
						// internal.
						const ownerUserId =
							input.purpose === 'shared'
								? null
								: (input.ownerUserId ?? session.userId)
						if (input.purpose === 'shared' && input.isPrivate === true) {
							return yield* new BadRequest({
								message: 'Shared inboxes cannot be private',
							})
						}

						// Generate the inbox id up-front so HKDF can derive a stable
						// per-row subkey before INSERT.
						const inboxId = randomUUID()

						const encrypted = crypto.encryptPassword({
							inboxId,
							plain: input.password,
						})

						// If a different default already exists for this (owner,
						// purpose) bucket, clear it first — the partial unique
						// index covers (organization_id, owner_user_id, purpose)
						// and would otherwise reject the INSERT.
						if (input.isDefault) {
							const ownerCondition = ownerUserId
								? sql`owner_user_id = ${ownerUserId}`
								: sql`owner_user_id IS NULL`
							yield* sql`
								UPDATE inboxes
								SET is_default = false, updated_at = now()
								WHERE organization_id = ${currentOrg.id}
								  AND ${ownerCondition}
								  AND purpose = ${input.purpose}
								  AND is_default = true
							`
						}

						// Probe IMAP LOGIN + SMTP EHLO/AUTH against the supplied
						// credentials. We still INSERT the row on probe failure so
						// the user sees it in settings and can fix the password —
						// `grant_status` records why the connection isn't usable
						// yet, and the worker will skip it until `testInbox`
						// flips the status back to `connected`.
						const probe = yield* transport
							.probe({
								inboxId,
								imapHost: input.imapHost,
								imapPort: input.imapPort,
								imapSecurity: input.imapSecurity,
								smtpHost: input.smtpHost,
								smtpPort: input.smtpPort,
								smtpSecurity: input.smtpSecurity,
								username: input.username,
								password: input.password,
							})
							.pipe(
								Effect.match({
									onSuccess: () =>
										({
											status: 'connected',
											detail: null,
										}) as const,
									onFailure: err =>
										({
											status:
												err._tag === 'GrantAuthFailed'
													? ('auth_failed' as const)
													: ('connect_failed' as const),
											detail: err.detail ?? null,
										}) as const,
								}),
							)

						const rows = yield* sql<InboxRow>`
							INSERT INTO inboxes ${sql.insert({
								id: inboxId,
								organizationId: currentOrg.id,
								email: input.email,
								displayName: input.displayName ?? null,
								purpose: input.purpose,
								ownerUserId,
								isDefault: input.isDefault ?? false,
								isPrivate: input.isPrivate ?? false,
								active: true,
								imapHost: input.imapHost,
								imapPort: input.imapPort,
								imapSecurity: input.imapSecurity,
								smtpHost: input.smtpHost,
								smtpPort: input.smtpPort,
								smtpSecurity: input.smtpSecurity,
								username: input.username,
								passwordCiphertext: encrypted.ciphertext,
								passwordNonce: encrypted.nonce,
								passwordTag: encrypted.tag,
								grantStatus: probe.status,
								grantLastError: probe.detail,
								grantLastSeenAt: new Date(),
								folderState: '{}',
							})}
							RETURNING ${selectInboxColumns}
						`
						yield* Effect.logInfo('Inbox created').pipe(
							Effect.annotateLogs({
								event: 'inbox.created',
								email: input.email,
								purpose: input.purpose,
							}),
						)
						return rows[0]!
					}),

				updateInbox: (
					id: string,
					patch: {
						displayName?: string | null | undefined
						purpose?: 'human' | 'agent' | 'shared' | undefined
						ownerUserId?: string | null | undefined
						isPrivate?: boolean | undefined
						isDefault?: boolean | undefined
						active?: boolean | undefined
						imapHost?: string | undefined
						imapPort?: number | undefined
						imapSecurity?: 'tls' | 'starttls' | 'plain' | undefined
						smtpHost?: string | undefined
						smtpPort?: number | undefined
						smtpSecurity?: 'tls' | 'starttls' | 'plain' | undefined
						username?: string | undefined
						password?: string | undefined
					},
				) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg

						// Existence + org scope first so the rest of the work cannot
						// silently target someone else's row.
						const existing = yield* resolveInbox(id)
						if (!existing) {
							return yield* new NotFound({ entity: 'Inbox', id })
						}

						const sets: Array<Statement.Fragment> = []
						if (patch.displayName !== undefined)
							sets.push(sql`display_name = ${patch.displayName}`)
						if (patch.purpose !== undefined)
							sets.push(sql`purpose = ${patch.purpose}`)
						if (patch.ownerUserId !== undefined)
							sets.push(sql`owner_user_id = ${patch.ownerUserId}`)
						if (patch.isPrivate !== undefined)
							sets.push(sql`is_private = ${patch.isPrivate}`)
						if (patch.isDefault !== undefined)
							sets.push(sql`is_default = ${patch.isDefault}`)
						if (patch.active !== undefined)
							sets.push(sql`active = ${patch.active}`)
						if (patch.imapHost !== undefined)
							sets.push(sql`imap_host = ${patch.imapHost}`)
						if (patch.imapPort !== undefined)
							sets.push(sql`imap_port = ${patch.imapPort}`)
						if (patch.imapSecurity !== undefined)
							sets.push(sql`imap_security = ${patch.imapSecurity}`)
						if (patch.smtpHost !== undefined)
							sets.push(sql`smtp_host = ${patch.smtpHost}`)
						if (patch.smtpPort !== undefined)
							sets.push(sql`smtp_port = ${patch.smtpPort}`)
						if (patch.smtpSecurity !== undefined)
							sets.push(sql`smtp_security = ${patch.smtpSecurity}`)
						if (patch.username !== undefined)
							sets.push(sql`username = ${patch.username}`)
						if (patch.password !== undefined) {
							const encrypted = crypto.encryptPassword({
								inboxId: id,
								plain: patch.password,
							})
							sets.push(sql`password_ciphertext = ${encrypted.ciphertext}`)
							sets.push(sql`password_nonce = ${encrypted.nonce}`)
							sets.push(sql`password_tag = ${encrypted.tag}`)
							// Reset the grant state so the worker re-probes on next tick.
							sets.push(sql`grant_status = 'connected'`)
							sets.push(sql`grant_last_error = NULL`)
						}

						if (sets.length === 0) {
							return existing
						}

						// Promoting to default requires clearing the prior default
						// in the same (owner, purpose) bucket, mirroring createInbox.
						if (patch.isDefault === true) {
							const targetPurpose = patch.purpose ?? existing.purpose
							const targetOwner =
								patch.ownerUserId !== undefined
									? patch.ownerUserId
									: existing.ownerUserId
							const ownerCondition = targetOwner
								? sql`owner_user_id = ${targetOwner}`
								: sql`owner_user_id IS NULL`
							yield* sql`
								UPDATE inboxes
								SET is_default = false, updated_at = now()
								WHERE organization_id = ${currentOrg.id}
								  AND ${ownerCondition}
								  AND purpose = ${targetPurpose}
								  AND is_default = true
								  AND id <> ${id}
							`
						}

						sets.push(sql`updated_at = now()`)

						const rows = yield* sql<InboxRow>`
							UPDATE inboxes
							SET ${sql.csv(sets)}
							WHERE id = ${id}
							  AND organization_id = ${currentOrg.id}
							RETURNING ${selectInboxColumns}
						`
						if (rows.length === 0) {
							return yield* new NotFound({ entity: 'Inbox', id })
						}
						return rows[0]!
					}),

				deleteInbox: (id: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						// Soft delete: thread history (and message search) needs the
						// inbox row to keep resolving long after the user removes it.
						// `active=false` flips the worker off and hides the inbox
						// from compose/picker UIs.
						const rows = yield* sql<InboxRow>`
							UPDATE inboxes
							SET active = false, is_default = false, updated_at = now()
							WHERE id = ${id}
							  AND organization_id = ${currentOrg.id}
							RETURNING ${selectInboxColumns}
						`
						if (rows.length === 0) {
							return yield* new NotFound({ entity: 'Inbox', id })
						}
						return rows[0]!
					}),

				// Re-probe stored credentials by decrypting in-memory and running
				// IMAP LOGIN + SMTP verify against the configured hosts. The
				// inbox row is updated with the probe outcome so the UI can
				// refresh the status badge without reloading the entire list.
				testInbox: (id: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg

						const credRows = yield* sql<{
							imapHost: string
							imapPort: number
							imapSecurity: 'tls' | 'starttls' | 'plain'
							smtpHost: string
							smtpPort: number
							smtpSecurity: 'tls' | 'starttls' | 'plain'
							username: string
							passwordCiphertext: Uint8Array
							passwordNonce: Uint8Array
							passwordTag: Uint8Array
						}>`
							SELECT
								imap_host          AS "imapHost",
								imap_port          AS "imapPort",
								imap_security      AS "imapSecurity",
								smtp_host          AS "smtpHost",
								smtp_port          AS "smtpPort",
								smtp_security      AS "smtpSecurity",
								username,
								password_ciphertext AS "passwordCiphertext",
								password_nonce     AS "passwordNonce",
								password_tag       AS "passwordTag"
							FROM inboxes
							WHERE id = ${id}
							  AND organization_id = ${currentOrg.id}
							LIMIT 1
						`.pipe(Effect.orDie)
						const cred = credRows[0]
						if (!cred) {
							return yield* new NotFound({ entity: 'Inbox', id })
						}

						const password = crypto.decryptPassword({
							inboxId: id,
							ciphertext: cred.passwordCiphertext,
							nonce: cred.passwordNonce,
							tag: cred.passwordTag,
						})

						const probe = yield* transport
							.probe({
								inboxId: id,
								imapHost: cred.imapHost,
								imapPort: cred.imapPort,
								imapSecurity: cred.imapSecurity,
								smtpHost: cred.smtpHost,
								smtpPort: cred.smtpPort,
								smtpSecurity: cred.smtpSecurity,
								username: cred.username,
								password,
							})
							.pipe(
								Effect.match({
									onSuccess: () =>
										({
											status: 'connected' as const,
											detail: null as string | null,
										}) as const,
									onFailure: err =>
										({
											status:
												err._tag === 'GrantAuthFailed'
													? ('auth_failed' as const)
													: ('connect_failed' as const),
											detail: err.detail ?? null,
										}) as const,
								}),
							)

						const rows = yield* sql<InboxRow>`
							UPDATE inboxes
							SET
								grant_status = ${probe.status},
								grant_last_error = ${probe.detail},
								grant_last_seen_at = now(),
								updated_at = now()
							WHERE id = ${id}
							  AND organization_id = ${currentOrg.id}
							RETURNING ${selectInboxColumns}
						`
						if (rows.length === 0) {
							return yield* new NotFound({ entity: 'Inbox', id })
						}
						return rows[0]!
					}),

				// Promotes a single inbox to `is_default=true` for the calling
				// member. Validates ownership so a member cannot promote an
				// org-mate's inbox (or a shared inbox) into their own primary
				// slot.
				setPrimaryInbox: (id: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const session = yield* SessionContext

						const target = yield* resolveInbox(id)
						if (!target) {
							return yield* new NotFound({ entity: 'Inbox', id })
						}
						if (target.purpose !== 'human') {
							return yield* new BadRequest({
								message: 'Only human inboxes can be set as primary',
							})
						}
						if (target.ownerUserId !== session.userId) {
							return yield* new BadRequest({
								message: 'Cannot set someone else’s inbox as primary',
							})
						}
						if (!target.active) {
							return yield* new BadRequest({
								message: 'Cannot set an inactive inbox as primary',
							})
						}

						yield* sql.withTransaction(
							Effect.gen(function* () {
								yield* sql`
									UPDATE inboxes
									SET is_default = false, updated_at = now()
									WHERE organization_id = ${currentOrg.id}
									  AND owner_user_id = ${session.userId}
									  AND purpose = 'human'
									  AND is_default = true
									  AND id <> ${id}
								`
								yield* sql`
									UPDATE inboxes
									SET is_default = true, updated_at = now()
									WHERE id = ${id}
									  AND organization_id = ${currentOrg.id}
								`
							}),
						)
						const refreshed = yield* resolveInbox(id)
						return refreshed!
					}),

				// Inbound attachment byte stream. For messages whose attachments
				// JSONB is populated (mail-worker-ingested rows), the bytes
				// already live in object storage at a sibling key — one GET
				// suffices, no parse-on-demand. For legacy / outbound rows
				// without the JSONB, fall back to the provider abstraction.
				streamAttachment: (messageId: string, attachmentId: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const rows = yield* sql<{
							inboxId: string | null
							messageIdRfc: string
							attachments: ReadonlyArray<{
								index: number
								filename: string
								contentType: string
								sizeBytes: number
								cid: string | null
								isInline: boolean
								storageKey: string
							}>
						}>`
							SELECT
								inbox_id,
								message_id AS message_id_rfc,
								attachments
							FROM email_messages
							WHERE organization_id = ${currentOrg.id}
							  AND (id::text = ${messageId} OR message_id = ${messageId})
							LIMIT 1
						`.pipe(Effect.orDie)
						const row = rows[0]
						if (!row || !row.inboxId) {
							return yield* new NotFound({
								entity: 'EmailMessage',
								id: messageId,
							})
						}

						// Prefer the JSONB path when the row has metadata: parse the
						// `attachmentId` URL segment as the array index. Anything
						// else (provider attachment ids, cid lookups) falls through
						// to the provider so legacy paths still work.
						const idx = Number.parseInt(attachmentId, 10)
						const meta = row.attachments?.[idx]
						if (
							row.attachments &&
							row.attachments.length > 0 &&
							Number.isFinite(idx) &&
							meta !== undefined
						) {
							const bytes = yield* storage.get(meta.storageKey).pipe(
								Effect.mapError(
									err =>
										new EmailError({
											message: `attachment fetch failed: ${err.message}`,
										}),
								),
							)
							const stream = new ReadableStream<Uint8Array>({
								start(controller) {
									controller.enqueue(bytes)
									controller.close()
								},
							})
							return {
								stream,
								contentType: meta.contentType,
								filename: meta.filename,
								size: meta.sizeBytes,
							}
						}

						return yield* provider.streamAttachment(
							row.inboxId,
							row.messageIdRfc,
							attachmentId,
						)
					}),

				// ── Drafts ──────────────────────────────────────────────────
				// Drafts live in Postgres via DraftStore. The editor block tree
				// is the source of truth; html/text render on send.
				// Threading metadata (mode, threadLinkId, inReplyTo) is real
				// columns now — no clientId-string stuffing.

				createDraft: (
					inboxId: string,
					params: {
						to?: string | string[] | undefined
						cc?: string | string[] | undefined
						bcc?: string | string[] | undefined
						subject?: string | undefined
						bodyJson?: EmailBlocks | undefined
						inReplyTo?: string | undefined
					},
					context?: {
						companyId?: string
						contactId?: string
						mode?: string
						threadLinkId?: string
					},
				) =>
					Effect.gen(function* () {
						const inbox = yield* resolveInbox(inboxId)
						if (!inbox) {
							return yield* new NotFound({ entity: 'Inbox', id: inboxId })
						}
						const draft = yield* drafts.create({
							inboxId: inbox.id,
							mode: context?.mode === 'reply' ? 'reply' : 'new',
							to: toRecipientArray(params.to) ?? [],
							cc: toRecipientArray(params.cc) ?? [],
							bcc: toRecipientArray(params.bcc) ?? [],
							subject: params.subject ?? null,
							inReplyTo: params.inReplyTo ?? null,
							threadLinkId: context?.threadLinkId ?? null,
							clientId: context ? encodeClientId(context) : null,
							bodyJson: params.bodyJson ?? {},
						})
						return draftRowToProviderShape(draft)
					}),

				updateDraft: (
					inboxId: string,
					draftId: string,
					params: {
						to?: string | string[] | undefined
						cc?: string | string[] | undefined
						bcc?: string | string[] | undefined
						subject?: string | undefined
						bodyJson?: EmailBlocks | undefined
					},
				) =>
					Effect.gen(function* () {
						const inbox = yield* resolveInbox(inboxId)
						if (!inbox) {
							return yield* new NotFound({ entity: 'Inbox', id: inboxId })
						}
						const updated = yield* drafts.update(draftId, {
							...(params.to !== undefined && {
								to: toRecipientArray(params.to) ?? [],
							}),
							...(params.cc !== undefined && {
								cc: toRecipientArray(params.cc) ?? [],
							}),
							...(params.bcc !== undefined && {
								bcc: toRecipientArray(params.bcc) ?? [],
							}),
							...(params.subject !== undefined && { subject: params.subject }),
							...(params.bodyJson !== undefined && {
								bodyJson: params.bodyJson,
							}),
						})
						return draftRowToProviderShape(updated)
					}),

				deleteDraft: (inboxId: string, draftId: string) =>
					Effect.gen(function* () {
						const inbox = yield* resolveInbox(inboxId)
						if (!inbox) {
							return yield* new NotFound({ entity: 'Inbox', id: inboxId })
						}
						yield* staging.sweepForDraft(draftId).pipe(Effect.ignore)
						yield* drafts.remove(draftId)
					}),

				getDraft: (inboxId: string, draftId: string) =>
					Effect.gen(function* () {
						const inbox = yield* resolveInbox(inboxId)
						if (!inbox) {
							return yield* new NotFound({ entity: 'Inbox', id: inboxId })
						}
						const draft = yield* drafts.get(draftId)
						return draftRowToProviderShape(draft)
					}),

				listDrafts: (inboxId?: string) =>
					Effect.gen(function* () {
						const list = yield* drafts.list(inboxId)
						return list
							.map(draftRowToProviderShape)
							.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
					}),

				sendDraft: (inboxId: string, draftId: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const inbox = yield* resolveInbox(inboxId)
						if (!inbox) {
							return yield* new NotFound({ entity: 'Inbox', id: inboxId })
						}
						yield* assertInboxUsable(inbox)

						const draft = yield* drafts.get(draftId)
						const ctx = parseClientId(draft.clientId ?? undefined)

						if (ctx.contactId) {
							yield* assertContactNotSuppressed(
								ctx.contactId,
								draft.toAddresses as string[],
							)
						}

						// Reply path needs the parent thread's external_thread_id +
						// references chain so the new message lands inside that
						// thread instead of opening a fresh one. Prefer the column
						// on the draft row; fall back to the parsed clientId for
						// rows created before the schema change.
						const threadLinkId = draft.threadLinkId ?? ctx.threadLinkId
						let existingThreadLink: {
							id: string
							externalThreadId: string
						} | null = null
						if (draft.mode === 'reply' && threadLinkId) {
							const linkRows = yield* sql<{
								id: string
								externalThreadId: string
							}>`
								SELECT id, external_thread_id
								FROM email_thread_links
								WHERE id = ${threadLinkId}
								  AND organization_id = ${currentOrg.id}
								LIMIT 1
							`.pipe(Effect.orDie)
							existingThreadLink = linkRows[0] ?? null
						}

						// Resolve staged attachments for this draft + render the
						// editor block tree to text/html. Footer is appended
						// unconditionally — DraftStore doesn't expose a skipFooter
						// flag yet, so drafts always get the inbox's default footer.
						const refRows = yield* sql<{
							stagingId: string
							isInline: boolean
							cid: string | null
							filename: string
						}>`
							SELECT staging_id, is_inline, cid, filename
							FROM email_attachment_staging
							WHERE draft_id = ${draftId}
							  AND sent_at IS NULL
						`.pipe(Effect.orDie)
						const stagedRefs: StagingRef[] = refRows.map(r => ({
							stagingId: r.stagingId,
							inline: r.isInline,
							...(r.cid !== null && { cid: r.cid }),
							filename: r.filename,
						}))
						const staged = yield* staging.resolve(inbox.id, stagedRefs)
						const footerBlocks = yield* resolveDefaultFooter(inbox.id)
						const blocks: EmailBlocks = footerBlocks
							? [
									...(Array.isArray(draft.bodyJson)
										? (draft.bodyJson as EmailBlocks)
										: []),
									...footerBlocks,
								]
							: Array.isArray(draft.bodyJson)
								? (draft.bodyJson as EmailBlocks)
								: []
						const rendered = yield* Effect.tryPromise({
							try: () =>
								renderBlocks(blocks, {
									attachments: toStagedRefs(staged),
								}),
							catch: err =>
								new EmailError({
									message: `renderBlocks: ${err instanceof Error ? err.message : String(err)}`,
								}),
						})

						const outbound: OutboundMessage = {
							from: inbox.email,
							to: draft.toAddresses as string[],
							subject: draft.subject ?? '',
							text: rendered.text,
							html: rendered.html,
							...(draft.ccAddresses.length > 0 && {
								cc: draft.ccAddresses as string[],
							}),
							...(draft.bccAddresses.length > 0 && {
								bcc: draft.bccAddresses as string[],
							}),
							...(existingThreadLink && {
								inReplyTo: existingThreadLink.externalThreadId,
								references: [existingThreadLink.externalThreadId],
							}),
							...(staged.length > 0 && {
								attachments: toOutboundAttachments(toSendAttachments(staged)),
							}),
						}

						const dispatched = yield* dispatchOutbound(inbox, outbound)
						const result = {
							messageId: dispatched.messageId,
							threadId: existingThreadLink
								? existingThreadLink.externalThreadId
								: dispatched.messageId,
						}

						yield* recordOutbound({
							result,
							inbox,
							companyId: ctx.companyId,
							contactId: ctx.contactId,
							subject: draft.subject ?? null,
							to: draft.toAddresses as string[],
							cc: draft.ccAddresses as string[],
							bcc: draft.bccAddresses as string[],
							existingThreadLink,
							rawRfc822Ref: dispatched.rawRef,
						})

						if (staged.length > 0) {
							yield* staging
								.markSentAndCleanup(staged.map(s => s.stagingId))
								.pipe(Effect.ignore)
						}

						yield* drafts.remove(draftId)

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
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						return yield* sql`
							SELECT * FROM inbox_footers
							WHERE inbox_id = ${inboxId}
							  AND organization_id = ${currentOrg.id}
							ORDER BY is_default DESC, name
						`
					}).pipe(Effect.orDie),

				getFooter: (id: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const rows = yield* sql`
							SELECT * FROM inbox_footers
							WHERE id = ${id}
							  AND organization_id = ${currentOrg.id}
							LIMIT 1
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
					bodyJson: EmailBlocks
					isDefault?: boolean
				}) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const inbox = yield* resolveInbox(input.inboxId)
						if (!inbox) {
							return yield* new NotFound({
								entity: 'Inbox',
								id: input.inboxId,
							})
						}
						if (input.isDefault) {
							yield* sql`
								UPDATE inbox_footers
								SET is_default = false, updated_at = now()
								WHERE inbox_id = ${input.inboxId}
								  AND organization_id = ${currentOrg.id}
								  AND is_default = true
							`
						}
						const rows = yield* sql`
							INSERT INTO inbox_footers ${sql.insert({
								organizationId: currentOrg.id,
								inboxId: input.inboxId,
								name: input.name,
								bodyJson: JSON.stringify(input.bodyJson),
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
						bodyJson?: EmailBlocks
						isDefault?: boolean
					},
				) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						if (patch.isDefault === true) {
							const existing = yield* sql<{ inboxId: string }>`
								SELECT inbox_id FROM inbox_footers
								WHERE id = ${id}
								  AND organization_id = ${currentOrg.id}
								LIMIT 1
							`
							if (existing[0]) {
								yield* sql`
									UPDATE inbox_footers
									SET is_default = false, updated_at = now()
									WHERE inbox_id = ${existing[0].inboxId}
									  AND organization_id = ${currentOrg.id}
									  AND is_default = true
									  AND id <> ${id}
								`
							}
						}
						const sets: Array<Statement.Fragment> = []
						if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`)
						if (patch.bodyJson !== undefined)
							sets.push(sql`body_json = ${JSON.stringify(patch.bodyJson)}`)
						if (patch.isDefault !== undefined)
							sets.push(sql`is_default = ${patch.isDefault}`)
						if (sets.length === 0) {
							const r = yield* sql`
								SELECT * FROM inbox_footers
								WHERE id = ${id}
								  AND organization_id = ${currentOrg.id}
								LIMIT 1
							`
							if (r.length === 0) {
								return yield* new NotFound({
									entity: 'InboxFooter',
									id,
								})
							}
							return r[0]!
						}
						sets.push(sql`updated_at = now()`)
						const rows = yield* sql`
							UPDATE inbox_footers
							SET ${sql.csv(sets)}
							WHERE id = ${id}
							  AND organization_id = ${currentOrg.id}
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
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						yield* sql`
							DELETE FROM inbox_footers
							WHERE id = ${id}
							  AND organization_id = ${currentOrg.id}
						`
					}).pipe(Effect.orDie),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
