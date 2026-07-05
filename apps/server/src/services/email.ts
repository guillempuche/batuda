import { randomUUID } from 'node:crypto'

import { Data, DateTime, Effect, Layer, Schedule, ServiceMap } from 'effect'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import {
	BadRequest,
	CurrentOrg,
	EmailError,
	EmailSuppressed,
	GrantUnavailable,
	MailboxInactive,
	NoDefaultMailbox,
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

import type {
	OutboundAttachment,
	OutboundMessage,
} from '@batuda/communications'

import { CalendarService } from './calendar.js'
import { CredentialCrypto } from './credential-crypto.js'
import type { ResolvedStaging, StagingRef } from './email-attachment-staging.js'
import { EmailAttachmentStaging } from './email-attachment-staging.js'
import { DraftStore } from './email-draft-store.js'
import {
	connectionAuth,
	type DecryptedCreds,
	MailTransport,
} from './mail-transport.js'
import { StorageProvider } from './storage-provider.js'
import { EmailSent, TimelineActivityService } from './timeline-activity.js'

// Typed tag so the handler can die deliberately and the staging sweep
// claims the orphaned attachment objects instead of leaking on a 500.
export class SmtpSendFailed extends Data.TaggedError('SmtpSendFailed')<{
	readonly cause: unknown
	readonly mailboxId: string
}> {}

// 1 + 3 retries spaced 1s/2s/4s → ~7s worst case before surfacing.
export const smtpRetrySchedule = Schedule.exponential('1 second', 2).pipe(
	Schedule.bothLeft(Schedule.recurs(3)),
)

export const retrySmtpSend = <A, E>(
	send: Effect.Effect<A, E>,
	mailboxId: string,
): Effect.Effect<A, SmtpSendFailed> =>
	send.pipe(
		Effect.retry(smtpRetrySchedule),
		Effect.mapError(cause => new SmtpSendFailed({ cause, mailboxId })),
	)

// PgClient.transformResultNames in apps/server/src/db/client.ts converts
// snake_case columns to camelCase on read, so every row type in this file
// is camelCase even though the SQL selects use snake_case.
// The suppression query filters to these two, so the row type narrows to them.
type ContactSuppressionRow = {
	status: 'bounced' | 'complained'
	statusReason: string | null
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
): readonly OutboundAttachment[] =>
	staged.map(s => ({
		filename: s.filename,
		contentType: s.contentType,
		contentBase64: s.contentBase64,
		disposition: s.inline ? 'inline' : 'attachment',
		...(s.inline && s.cid ? { contentId: s.cid } : {}),
	}))

const toOutboundAttachments = (
	atts: readonly OutboundAttachment[],
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
// (`messages/<org>/<mailbox>/<uidvalidity>/<uid>.eml`). Sanitize the
// Message-ID — nodemailer returns `<random@host>`; angle-brackets and
// any non-filename-safe glyph get folded to `_` so the path stays valid
// across S3-compatible backends.
const sentRawKey = (
	organizationId: string,
	mailboxId: string,
	messageId: string,
): string => {
	const safe = messageId.replace(/[<>]/g, '').replace(/[^a-zA-Z0-9@.\-_]/g, '_')
	return `messages/${organizationId}/${mailboxId}/sent/${safe}.eml`
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
	readonly mailboxId: string
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
	readonly mailboxId: string
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
	mailboxId: row.mailboxId,
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

// Vendor-neutral mailbox presets for the connect-mailbox picker. The transport
// fields mirror the createMailbox payload; helpUrl, appPasswordUrl and
// passwordAuthSupported are UI-only hints. Most providers accept an app-specific
// password under two-factor authentication, and appPasswordUrl points to where
// the user creates one. Gmail and Microsoft 365 are passwordAuthSupported=false:
// they dropped password sign-in for mail clients and need an OAuth connection
// the app does not offer yet, so the UI flags them when selected. Ordered by
// rough global popularity (most common first), with Generic IMAP last as the
// manual catch-all.
const PROVIDER_PRESETS = [
	{
		name: 'Gmail Workspace',
		imapHost: 'imap.gmail.com',
		imapPort: 993,
		imapSecurity: 'tls',
		smtpHost: 'smtp.gmail.com',
		smtpPort: 465,
		smtpSecurity: 'tls',
		helpUrl: 'https://support.google.com/mail/answer/7126229',
		appPasswordUrl: '',
		passwordAuthSupported: false,
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
		appPasswordUrl: '',
		passwordAuthSupported: false,
	},
	{
		name: 'iCloud Mail',
		imapHost: 'imap.mail.me.com',
		imapPort: 993,
		imapSecurity: 'tls',
		smtpHost: 'smtp.mail.me.com',
		smtpPort: 587,
		smtpSecurity: 'starttls',
		helpUrl: '',
		appPasswordUrl: 'https://support.apple.com/en-us/102654',
		passwordAuthSupported: true,
	},
	{
		name: 'Yahoo Mail',
		imapHost: 'imap.mail.yahoo.com',
		imapPort: 993,
		imapSecurity: 'tls',
		smtpHost: 'smtp.mail.yahoo.com',
		smtpPort: 465,
		smtpSecurity: 'tls',
		helpUrl: '',
		appPasswordUrl: 'https://help.yahoo.com/kb/SLN15241.html',
		passwordAuthSupported: true,
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
		appPasswordUrl: '',
		passwordAuthSupported: true,
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
		appPasswordUrl:
			'https://www.fastmail.help/hc/en-us/articles/360058752854-App-passwords',
		passwordAuthSupported: true,
	},
	{
		name: 'Infomaniak',
		imapHost: 'mail.infomaniak.com',
		imapPort: 993,
		imapSecurity: 'tls',
		smtpHost: 'mail.infomaniak.com',
		smtpPort: 465,
		smtpSecurity: 'tls',
		helpUrl: 'https://www.infomaniak.com/en/support/faq/2427',
		// Infomaniak splits passwords in two: the account-level "application
		// password" (FAQ 2855) only works for contacts/calendars, never IMAP.
		// IMAP/SMTP needs a per-mailbox device password created in Mail Service
		// (FAQ 1321) — point users there or they hit "Invalid login or password".
		appPasswordUrl:
			'https://www.infomaniak.com/en/support/faq/1321/add-a-device-generate-app-specific-password-via-the-mail-app',
		passwordAuthSupported: true,
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
		appPasswordUrl: '',
		passwordAuthSupported: true,
	},
] as const

type MailboxRow = {
	id: string
	organizationId: string
	provider: 'imap-smtp' | 'gmail-oauth' | 'm365-oauth'
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
					// Suppression is per-address now: block only when the specific
					// email channel being sent to is bounced/complained.
					const recipients = (
						Array.isArray(recipient) ? recipient : [recipient]
					).map(r => r.toLowerCase())
					const rows = yield* sql<ContactSuppressionRow>`
						SELECT status, status_reason
						FROM contact_channels
						WHERE contact_id = ${contactId}
						  AND channel = 'email'
						  AND lower(address) = ANY(${recipients})
						  AND status IN ('bounced', 'complained')
						LIMIT 1
					`
					const row = rows[0]
					if (row) {
						return yield* new EmailSuppressed({
							contactId,
							recipient: firstRecipient(recipient),
							status: row.status,
							reason: row.statusReason,
						})
					}
				})

			// ── Mailbox lookups (org-scoped) ────────────────────────────────
			//
			// Every mailbox read narrows by the active organization id so a
			// caller cannot accidentally (or deliberately) reach across orgs
			// even if the planner skips the RLS policy.

			const selectMailboxColumns = sql`
				id, organization_id, provider, external_id AS "email", display_name, purpose, owner_user_id,
				is_default, is_private, active, imap_host, imap_port, imap_security,
				smtp_host, smtp_port, smtp_security, username,
				grant_status, grant_last_error, grant_last_seen_at,
				created_at, updated_at
			`

			const resolveMailbox = (mailboxId: string) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const rows = yield* sql<MailboxRow>`
						SELECT ${selectMailboxColumns} FROM channel_connections
						WHERE id = ${mailboxId}
						  AND organization_id = ${currentOrg.id}
						LIMIT 1
					`.pipe(Effect.orDie)
					return rows[0] ?? null
				})

			// Decrypt the stored credentials in-memory, run an IMAP LOGIN + SMTP
			// verify against the configured hosts, and persist the outcome so the
			// status badge reflects reality. Shared by testMailbox (a manual
			// re-test) and updateMailbox (immediate feedback after a credential or
			// transport change) so both report connect/auth failures identically.
			const reprobeMailbox = (id: string) =>
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
						provider: 'imap-smtp' | 'gmail-oauth' | 'm365-oauth'
						configCiphertext: Uint8Array
						configNonce: Uint8Array
						configTag: Uint8Array
					}>`
						SELECT
							imap_host          AS "imapHost",
							imap_port          AS "imapPort",
							imap_security      AS "imapSecurity",
							smtp_host          AS "smtpHost",
							smtp_port          AS "smtpPort",
							smtp_security      AS "smtpSecurity",
							username,
							provider,
							config_ciphertext AS "configCiphertext",
							config_nonce     AS "configNonce",
							config_tag       AS "configTag"
						FROM channel_connections
						WHERE id = ${id}
						  AND organization_id = ${currentOrg.id}
						LIMIT 1
					`.pipe(Effect.orDie)
					const cred = credRows[0]
					if (!cred) {
						return yield* new NotFound({ entity: 'Mailbox', id })
					}

					const password = crypto.decryptConfig({
						connectionId: id,
						ciphertext: cred.configCiphertext,
						nonce: cred.configNonce,
						tag: cred.configTag,
					})

					const probe = yield* transport
						.probe({
							connectionId: id,
							imapHost: cred.imapHost,
							imapPort: cred.imapPort,
							imapSecurity: cred.imapSecurity,
							smtpHost: cred.smtpHost,
							smtpPort: cred.smtpPort,
							smtpSecurity: cred.smtpSecurity,
							username: cred.username,
							auth: connectionAuth(cred.provider, password),
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

					const rows = yield* sql<MailboxRow>`
						UPDATE channel_connections
						SET
							grant_status = ${probe.status},
							grant_last_error = ${probe.detail},
							grant_last_seen_at = now(),
							updated_at = now()
						WHERE id = ${id}
						  AND organization_id = ${currentOrg.id}
						RETURNING ${selectMailboxColumns}
					`
					if (rows.length === 0) {
						return yield* new NotFound({ entity: 'Mailbox', id })
					}
					return rows[0]!
				})

			const resolveDefaultMailboxForCurrentUser = () =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const session = yield* SessionContext
					const rows = yield* sql<MailboxRow>`
						SELECT ${selectMailboxColumns} FROM channel_connections
						WHERE organization_id = ${currentOrg.id}
						  AND owner_user_id = ${session.userId}
						  AND purpose = 'human'
						  AND is_default = true
						  AND active = true
						LIMIT 1
					`.pipe(Effect.orDie)
					const row = rows[0]
					if (!row) {
						return yield* new NoDefaultMailbox({
							message:
								'No primary mailbox configured. Connect a mailbox in Settings → Email.',
						})
					}
					return row
				})

			// Single guard used before every send/reply so the mailbox-state
			// failure modes (deactivated row, broken IMAP/SMTP credentials) all
			// raise the same tagged errors the route maps to 409s.
			const assertMailboxUsable = (mailbox: MailboxRow) =>
				Effect.gen(function* () {
					if (!mailbox.active) {
						return yield* new MailboxInactive({ mailboxId: mailbox.id })
					}
					if (mailbox.grantStatus !== 'connected') {
						return yield* new GrantUnavailable({
							mailboxId: mailbox.id,
							grantStatus: mailbox.grantStatus,
						})
					}
				})

			type FooterRow = { bodyJson: EmailBlocks }
			const resolveDefaultFooter = (mailboxId: string) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const rows = yield* sql<FooterRow>`
						SELECT body_json FROM connection_footers
						WHERE connection_id =${mailboxId}
						  AND organization_id = ${currentOrg.id}
						  AND is_default = true
						LIMIT 1
					`.pipe(Effect.orDie)
					return rows[0]?.bodyJson ?? null
				})

			type ParticipantRow = {
				messageId: string
				channel: string
				address: string
				displayName: string | null
				role: 'from' | 'to' | 'cc' | 'bcc'
				contactId: string | null
			}

			const buildParticipants = (
				messageId: string,
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
						messageId,
						channel: 'email',
						address: trimmed.toLowerCase(),
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

			// Pull the encrypted credential blob for an mailbox and decrypt it
			// in-process. Plaintext stays in memory only for the duration of
			// the SMTP send + IMAP APPEND below; never logged, never returned.
			const loadDecryptedCreds = (
				mailbox: MailboxRow,
			): Effect.Effect<DecryptedCreds, never, never> =>
				Effect.gen(function* () {
					const credRows = yield* sql<{
						configCiphertext: Uint8Array
						configNonce: Uint8Array
						configTag: Uint8Array
					}>`
						SELECT
							config_ciphertext AS "configCiphertext",
							config_nonce      AS "configNonce",
							config_tag        AS "configTag"
						FROM channel_connections
						WHERE id = ${mailbox.id}
						LIMIT 1
					`.pipe(Effect.orDie)
					const cred = credRows[0]
					if (!cred) {
						return yield* Effect.die(
							new Error(
								`mailbox ${mailbox.id} disappeared between resolve and send`,
							),
						)
					}
					const blob = crypto.decryptConfig({
						connectionId: mailbox.id,
						ciphertext: cred.configCiphertext,
						nonce: cred.configNonce,
						tag: cred.configTag,
					})
					return {
						connectionId: mailbox.id,
						imapHost: mailbox.imapHost,
						imapPort: mailbox.imapPort,
						imapSecurity: mailbox.imapSecurity,
						smtpHost: mailbox.smtpHost,
						smtpPort: mailbox.smtpPort,
						smtpSecurity: mailbox.smtpSecurity,
						username: mailbox.username,
						auth: connectionAuth(mailbox.provider, blob),
					}
				})

			// SMTP-send via the transport, persist the wire bytes in object
			// storage, and best-effort APPEND to the user's "Sent" folder so
			// the provider-side mailbox mirrors what we shipped. The APPEND
			// is best-effort because some providers (Gmail, M365) auto-copy
			// outbound to Sent and a duplicate would make the worker's next
			// IDLE tick churn — `idx_messages_msgid` would dedupe but
			// we save the round trip when we know the provider already did
			// it. APPEND failures land in the log; the row stays canonical.
			const dispatchOutbound = (
				mailbox: MailboxRow,
				message: OutboundMessage,
			): Effect.Effect<
				{ messageId: string; rawRef: string },
				SmtpSendFailed,
				never
			> =>
				Effect.gen(function* () {
					const creds = yield* loadDecryptedCreds(mailbox)
					const sent = yield* retrySmtpSend(
						transport.send(creds, message),
						mailbox.id,
					)
					const messageId = sent.messageId
					const key = sentRawKey(mailbox.organizationId, mailbox.id, messageId)
					yield* storage
						.put({ key, body: sent.raw, contentType: 'message/rfc822' })
						.pipe(
							Effect.catchCause(cause =>
								Effect.logWarning(
									`outbound raw upload failed mailbox=${mailbox.id} key=${key}`,
								).pipe(Effect.andThen(Effect.logError(cause))),
							),
						)
					yield* transport
						.appendToSent(creds, sent.raw)
						.pipe(
							Effect.catchCause(cause =>
								Effect.logWarning(
									`appendToSent failed mailbox=${mailbox.id} (provider may auto-copy)`,
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
				mailbox: MailboxRow
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
									INSERT INTO conversations ${sql.insert({
										organizationId: currentOrg.id,
										externalThreadId,
										connectionId: args.mailbox.id,
										companyId: args.companyId,
										contactId: args.contactId,
										subject: args.subject,
										status: 'open',
									})}
								`
							}

							const sentAt = DateTime.toDateUtc(DateTime.nowUnsafe())
							const emailRows = yield* sql<{ id: string }>`
								INSERT INTO messages ${sql.insert({
									organizationId: currentOrg.id,
									connectionId: args.mailbox.id,
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
									new Error('INSERT INTO messages RETURNING id yielded no row'),
								)
							}

							const participants = buildParticipants(
								emailMessage.id,
								args.mailbox.email,
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
					mailboxId: string | undefined,
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
						rawAttachments?: readonly OutboundAttachment[] | undefined
						skipFooter?: boolean | undefined
					},
				) =>
					Effect.gen(function* () {
						const cc = extras?.cc ?? []
						const bcc = extras?.bcc ?? []
						const attachmentRefs = extras?.attachmentRefs ?? []
						const rawAttachments = extras?.rawAttachments ?? []

						// Resolve to the calling member's primary human mailbox when no
						// id is supplied — the contract for /v1/email/send.
						const mailbox = mailboxId
							? yield* resolveMailbox(mailboxId).pipe(
									Effect.flatMap(row =>
										row
											? Effect.succeed(row)
											: Effect.fail(new MailboxInactive({ mailboxId })),
									),
								)
							: yield* resolveDefaultMailboxForCurrentUser()
						yield* assertMailboxUsable(mailbox)

						if (contactId) {
							yield* assertContactNotSuppressed(contactId, to)
						}

						const staged = yield* staging.resolve(mailbox.id, attachmentRefs)
						let blocks: EmailBlocks = bodyJson
						if (!extras?.skipFooter) {
							const footerBlocks = yield* resolveDefaultFooter(mailbox.id)
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
							from: mailbox.email,
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

						const dispatched = yield* dispatchOutbound(mailbox, outbound)
						// Outbound start-of-thread: the SMTP-assigned Message-ID
						// becomes the canonical thread root id. Replies will reuse
						// it via In-Reply-To / References.
						const result = {
							messageId: dispatched.messageId,
							threadId: dispatched.messageId,
						}

						yield* recordOutbound({
							result,
							mailbox,
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

				// `threadId` is the local `conversations.id` (UUID); the
				// service hops from there to the mailbox + the most recent
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
						rawAttachments?: readonly OutboundAttachment[] | undefined
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
							mailboxId: string | null
							companyId: string | null
							contactId: string | null
							subject: string | null
						}>`
							SELECT id, external_thread_id, connection_id AS "mailboxId", company_id, contact_id, subject
							FROM conversations
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

						if (!link.mailboxId) {
							return yield* new MailboxInactive({ mailboxId: link.id })
						}

						const mailbox = yield* resolveMailbox(link.mailboxId).pipe(
							Effect.flatMap(row =>
								row
									? Effect.succeed(row)
									: Effect.fail(
											new MailboxInactive({ mailboxId: link.mailboxId! }),
										),
							),
						)
						yield* assertMailboxUsable(mailbox)

						// Most recent message in the thread anchors the reply. We
						// match on `message_id = external_thread_id` (root) OR
						// `external_thread_id = ANY(references)` (any reply).
						const lastMessages = yield* sql<{
							messageId: string
							recipients: { from?: string; to?: string[] }
						}>`
							SELECT message_id, recipients
							FROM messages
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

						const staged = yield* staging.resolve(mailbox.id, attachmentRefs)
						let blocks: EmailBlocks = bodyJson
						if (!extras?.skipFooter) {
							const footerBlocks = yield* resolveDefaultFooter(mailbox.id)
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
							from: mailbox.email,
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

						const dispatched = yield* dispatchOutbound(mailbox, outbound)
						const result = {
							messageId: dispatched.messageId,
							threadId: link.externalThreadId,
						}

						yield* recordOutbound({
							result,
							mailbox,
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
							mailboxId: string | null
							companyId: string | null
							contactId: string | null
							subject: string | null
							status: string
							lastReadAt: Date | null
							createdAt: Date
							updatedAt: Date
							mailboxEmail: string | null
							mailboxDisplayName: string | null
							mailboxPurpose: 'human' | 'agent' | 'shared' | null
							mailboxIsPrivate: boolean | null
							mailboxOwnerUserId: string | null
						}>`
							SELECT
								tl.id,
								tl.external_thread_id,
								tl.connection_id AS "mailboxId",
								tl.company_id,
								tl.contact_id,
								tl.subject,
								tl.status,
								tl.last_read_at,
								tl.created_at,
								tl.updated_at,
								i.email AS mailbox_email,
								i.display_name AS mailbox_display_name,
								i.purpose AS mailbox_purpose,
								i.is_private AS mailbox_is_private,
								i.owner_user_id AS mailbox_owner_user_id
							FROM conversations tl
							LEFT JOIN channel_connections i ON i.id = tl.connection_id
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

						// Privacy gate: a thread anchored to a private mailbox is
						// invisible to anyone other than its owner. Surfaced as
						// NotFound so org-mates cannot enumerate private mailboxes
						// by trial-and-error.
						if (
							link.mailboxIsPrivate === true &&
							link.mailboxOwnerUserId !== session.userId
						) {
							return yield* new NotFound({
								entity: 'EmailThreadLink',
								id: threadId,
							})
						}

						// JOIN message_participants so the wire response can carry
						// `from` per message — the table stores sender as a
						// participant row with role='from' rather than a column on
						// messages. Without the JOIN the UI's `From` field
						// renders empty for every card.
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
							fromAddress: string | null
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
							SELECT em.id, em.message_id, em.in_reply_to, em."references",
							       em.direction, em.folder, em.subject, em.received_at,
							       em.text_preview, em.text_body, em.html_body, em.recipients,
							       em.attachments,
							       em.status, em.status_reason, em.bounce_type, em.bounce_sub_type,
							       em.inbound_classification, em.status_updated_at,
							       (
							         SELECT mp.address
							         FROM message_participants mp
							         WHERE mp.message_id = em.id
							           AND mp.role = 'from'
							         LIMIT 1
							       ) AS from_address
							FROM messages em
							WHERE em.organization_id = ${currentOrg.id}
							  AND (
							    em.message_id = ${link.externalThreadId}
							    OR ${link.externalThreadId} = ANY(em."references")
							  )
							ORDER BY em.received_at ASC NULLS LAST, em.status_updated_at ASC
						`.pipe(Effect.orDie)

						// Flatten to the UI's expected shape (keys it actually
						// reads in apps/internal/src/routes/emails/$threadId.tsx
						// `narrowMessages`): top-level `from`/`to`/`cc`, `text`/
						// `html`/`preview`, `timestamp`, and a `deliverability`
						// sub-object. We rebuild from scratch (instead of
						// spreading the SQL row) because Effect's HTTP
						// serializer flags repeat-visited references as
						// cycles — having both `recipients.to` and `to`
						// pointing at the same array trips it.
						const messagesOut = messages.map(m => {
							const fromAddress = m.fromAddress ?? ''
							return {
								id: m.id,
								messageId: m.messageId,
								inReplyTo: m.inReplyTo,
								references: m.references ?? [],
								direction: m.direction,
								folder: m.folder,
								subject: m.subject,
								from: fromAddress,
								to: [...(m.recipients?.to ?? [])],
								cc: [...(m.recipients?.cc ?? [])],
								bcc: [...(m.recipients?.bcc ?? [])],
								text: m.textBody,
								html: m.htmlBody,
								preview: m.textPreview,
								timestamp:
									m.receivedAt instanceof Date
										? m.receivedAt.toISOString()
										: m.receivedAt,
								attachments: m.attachments.map(a => ({
									attachmentId: String(a.index),
									filename: a.filename,
									size: a.sizeBytes,
									contentType: a.contentType,
									cid: a.cid,
									isInline: a.isInline,
								})),
								inboundClassification: m.inboundClassification,
								deliverability: {
									status: m.status,
									statusReason: m.statusReason,
									bounceType: m.bounceType,
									bounceSubType: m.bounceSubType,
									statusUpdatedAt:
										m.statusUpdatedAt instanceof Date
											? m.statusUpdatedAt.toISOString()
											: m.statusUpdatedAt,
								},
							}
						})

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
							mailbox:
								link.mailboxEmail && link.mailboxPurpose
									? {
											email: link.mailboxEmail,
											displayName: link.mailboxDisplayName,
											purpose: link.mailboxPurpose,
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
							UPDATE conversations
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
							UPDATE conversations
							SET last_read_at = now()
							WHERE id = ${threadId}
							  AND organization_id = ${currentOrg.id}
						`
					}).pipe(Effect.orDie),

				markThreadUnread: (threadId: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						yield* sql`
							UPDATE conversations
							SET last_read_at = NULL
							WHERE id = ${threadId}
							  AND organization_id = ${currentOrg.id}
						`
					}).pipe(Effect.orDie),

				listThreads: (filters?: {
					mailboxId?: string
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
							// Privacy gate: a private mailbox is hidden from anyone
							// other than its owner. Phrased as a join-side filter so
							// thread rows that have NO mailbox (legacy / mailbox deleted)
							// stay visible to whoever was already on the thread.
							sql`(i.id IS NULL OR i.is_private = false OR i.owner_user_id = ${session.userId})`,
						]
						if (filters?.mailboxId)
							conditions.push(sql`tl.connection_id = ${filters.mailboxId}`)
						if (filters?.companyId)
							conditions.push(sql`tl.company_id = ${filters.companyId}`)
						if (filters?.status)
							conditions.push(sql`tl.status = ${filters.status}`)
						if (filters?.purpose)
							conditions.push(sql`i.purpose = ${filters.purpose}`)
						if (filters?.query) {
							const trimmedQuery = filters.query.trim()
							if (trimmedQuery.length > 0) {
								// FTS over each message's subject + preview + body; the
								// separate participants subquery catches sender/recipient
								// hits, which the tsvector deliberately omits (unbounded
								// recipient sets would force a tsvector rebuild on every
								// reply).
								conditions.push(sql`(
									EXISTS (
										SELECT 1 FROM messages em
										WHERE em.organization_id = tl.organization_id
										  AND (em.message_id = tl.external_thread_id
										       OR tl.external_thread_id = ANY(em."references"))
										  AND em.search_vector @@ plainto_tsquery('simple', ${trimmedQuery})
									)
									OR EXISTS (
										SELECT 1 FROM messages em2
										JOIN message_participants mp ON mp.message_id = em2.id
										WHERE em2.organization_id = tl.organization_id
										  AND (em2.message_id = tl.external_thread_id
										       OR tl.external_thread_id = ANY(em2."references"))
										  AND mp.address ILIKE ${`%${trimmedQuery}%`}
									)
								)`)
							}
						}

						const whereClause = sql`WHERE ${sql.and(conditions)}`

						// Window COUNT(*) OVER () gives total in the same scan; the
						// per-thread sub-selects pivot on external_thread_id (the
						// column the threading index lives on) so each row stays a
						// constant-cost lookup.
						const rows = yield* sql<{
							id: string
							externalThreadId: string
							mailboxId: string | null
							companyId: string | null
							contactId: string | null
							subject: string | null
							status: string
							lastReadAt: Date | null
							createdAt: Date
							updatedAt: Date
							mailboxEmail: string | null
							mailboxDisplayName: string | null
							mailboxPurpose: 'human' | 'agent' | 'shared' | null
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
								tl.connection_id AS "mailboxId",
								tl.company_id,
								tl.contact_id,
								tl.subject,
								tl.status,
								tl.last_read_at,
								tl.created_at,
								tl.updated_at,
								i.email AS mailbox_email,
								i.display_name AS mailbox_display_name,
								i.purpose AS mailbox_purpose,
								(
									SELECT COUNT(*) FROM messages m
									WHERE m.organization_id = tl.organization_id
									  AND (m.message_id = tl.external_thread_id
									       OR tl.external_thread_id = ANY(m."references"))
								) AS message_count,
								(
									SELECT MAX(m.status_updated_at) FROM messages m
									WHERE m.organization_id = tl.organization_id
									  AND (m.message_id = tl.external_thread_id
									       OR tl.external_thread_id = ANY(m."references"))
								) AS last_message_at,
								(
									SELECT m.direction FROM messages m
									WHERE m.organization_id = tl.organization_id
									  AND (m.message_id = tl.external_thread_id
									       OR tl.external_thread_id = ANY(m."references"))
									ORDER BY m.status_updated_at DESC
									LIMIT 1
								) AS last_message_direction,
								(
									SELECT MAX(m.status_updated_at) FROM messages m
									WHERE m.organization_id = tl.organization_id
									  AND (m.message_id = tl.external_thread_id
									       OR tl.external_thread_id = ANY(m."references"))
									  AND m.direction = 'inbound'
								) AS last_inbound_at,
								(
									SELECT m.inbound_classification FROM messages m
									WHERE m.organization_id = tl.organization_id
									  AND (m.message_id = tl.external_thread_id
									       OR tl.external_thread_id = ANY(m."references"))
									  AND m.direction = 'inbound'
									ORDER BY m.status_updated_at DESC
									LIMIT 1
								) AS last_inbound_classification,
								(
									(
										SELECT MAX(m.status_updated_at) FROM messages m
										WHERE m.organization_id = tl.organization_id
										  AND (m.message_id = tl.external_thread_id
										       OR tl.external_thread_id = ANY(m."references"))
										  AND m.direction = 'inbound'
									) > COALESCE(tl.last_read_at, 'epoch'::timestamptz)
								) AS is_unread,
								COUNT(*) OVER () AS total
							FROM conversations tl
							LEFT JOIN channel_connections i ON i.id = tl.connection_id
							${whereClause}
							ORDER BY tl.updated_at DESC
							LIMIT ${limit}
							OFFSET ${offset}
						`

						const total = rows.length > 0 ? Number(rows[0]!.total) : 0
						const items = rows.map(r => {
							const {
								total: _t,
								mailboxEmail,
								mailboxDisplayName,
								mailboxPurpose,
								messageCount,
								...rest
							} = r
							return {
								...rest,
								messageCount: Number(messageCount),
								mailbox:
									mailboxEmail && mailboxPurpose
										? {
												email: mailboxEmail,
												displayName: mailboxDisplayName,
												purpose: mailboxPurpose,
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
							SELECT * FROM messages
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
							SELECT * FROM messages
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

				// ── Mailbox CRUD ────────────────────────────────────────────────

				listProviderPresets: () => Effect.succeed(PROVIDER_PRESETS),

				listLocalMailboxes: (filters?: {
					purpose?: 'human' | 'agent' | 'shared'
					active?: boolean
					ownerUserId?: string
				}) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const session = yield* SessionContext
						const conditions: Array<Statement.Fragment> = [
							sql`organization_id = ${currentOrg.id}`,
							// Same privacy gate as listThreads — own private mailboxes
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
							SELECT ${selectMailboxColumns}
							FROM channel_connections
							WHERE ${sql.and(conditions)}
							ORDER BY is_default DESC, purpose, email
						`
					}).pipe(Effect.orDie),

				mailboxStatus: () =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const session = yield* SessionContext
						const rows = yield* sql<{ id: string; email: string }>`
							SELECT id, external_id AS "email" FROM channel_connections
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
							primary: { mailboxId: row.id, email: row.email },
						}
					}),

				createMailbox: (input: {
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
						// human mailboxes when ownerUserId is omitted; reject the
						// shared+owner mismatch up-front so the DB error stays
						// internal.
						const ownerUserId =
							input.purpose === 'shared'
								? null
								: (input.ownerUserId ?? session.userId)
						if (input.purpose === 'shared' && input.isPrivate === true) {
							return yield* new BadRequest({
								message: 'Shared mailboxes cannot be private',
							})
						}

						// Generate the mailbox id up-front so HKDF can derive a stable
						// per-row subkey before INSERT.
						const mailboxId = randomUUID()

						const encrypted = crypto.encryptConfig({
							connectionId: mailboxId,
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
								UPDATE channel_connections
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
						// yet, and the worker will skip it until `testMailbox`
						// flips the status back to `connected`.
						const probe = yield* transport
							.probe({
								connectionId: mailboxId,
								imapHost: input.imapHost,
								imapPort: input.imapPort,
								imapSecurity: input.imapSecurity,
								smtpHost: input.smtpHost,
								smtpPort: input.smtpPort,
								smtpSecurity: input.smtpSecurity,
								username: input.username,
								auth: { kind: 'password', password: input.password },
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

						const rows = yield* sql<MailboxRow>`
							INSERT INTO channel_connections ${sql.insert({
								id: mailboxId,
								organizationId: currentOrg.id,
								externalId: input.email,
								channel: 'email',
								provider: 'imap-smtp',
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
								configCiphertext: encrypted.ciphertext,
								configNonce: encrypted.nonce,
								configTag: encrypted.tag,
								grantStatus: probe.status,
								grantLastError: probe.detail,
								grantLastSeenAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
								syncState: '{}',
							})}
							RETURNING ${selectMailboxColumns}
						`
						yield* Effect.logInfo('Mailbox created').pipe(
							Effect.annotateLogs({
								event: 'mailbox.created',
								email: input.email,
								purpose: input.purpose,
							}),
						)
						return rows[0]!
					}),

				updateMailbox: (
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
						const existing = yield* resolveMailbox(id)
						if (!existing) {
							return yield* new NotFound({ entity: 'Mailbox', id })
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
							const encrypted = crypto.encryptConfig({
								connectionId: id,
								plain: patch.password,
							})
							sets.push(sql`config_ciphertext = ${encrypted.ciphertext}`)
							sets.push(sql`config_nonce = ${encrypted.nonce}`)
							sets.push(sql`config_tag = ${encrypted.tag}`)
						}

						if (sets.length === 0) {
							return existing
						}

						// A credential or transport change is re-probed after the
						// write so the returned row reflects the real connection
						// state — createMailbox probes up-front, and an edit that only
						// touches metadata (e.g. display name) skips the probe.
						const credentialsChanged =
							patch.password !== undefined ||
							patch.username !== undefined ||
							patch.imapHost !== undefined ||
							patch.imapPort !== undefined ||
							patch.imapSecurity !== undefined ||
							patch.smtpHost !== undefined ||
							patch.smtpPort !== undefined ||
							patch.smtpSecurity !== undefined

						// Promoting to default requires clearing the prior default
						// in the same (owner, purpose) bucket, mirroring createMailbox.
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
								UPDATE channel_connections
								SET is_default = false, updated_at = now()
								WHERE organization_id = ${currentOrg.id}
								  AND ${ownerCondition}
								  AND purpose = ${targetPurpose}
								  AND is_default = true
								  AND id <> ${id}
							`
						}

						sets.push(sql`updated_at = now()`)

						const rows = yield* sql<MailboxRow>`
							UPDATE channel_connections
							SET ${sql.csv(sets)}
							WHERE id = ${id}
							  AND organization_id = ${currentOrg.id}
							RETURNING ${selectMailboxColumns}
						`
						if (rows.length === 0) {
							return yield* new NotFound({ entity: 'Mailbox', id })
						}
						if (credentialsChanged) {
							return yield* reprobeMailbox(id)
						}
						return rows[0]!
					}),

				deleteMailbox: (id: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						// Soft delete: thread history (and message search) needs the
						// mailbox row to keep resolving long after the user removes it.
						// `active=false` flips the worker off and hides the mailbox
						// from compose/picker UIs.
						const rows = yield* sql<MailboxRow>`
							UPDATE channel_connections
							SET active = false, is_default = false, updated_at = now()
							WHERE id = ${id}
							  AND organization_id = ${currentOrg.id}
							RETURNING ${selectMailboxColumns}
						`
						if (rows.length === 0) {
							return yield* new NotFound({ entity: 'Mailbox', id })
						}
						return rows[0]!
					}),

				// Manual re-test of a stored mailbox — decrypt, probe, and write
				// back the grant status. Shares reprobeMailbox with updateMailbox.
				testMailbox: (id: string) => reprobeMailbox(id),

				// Promotes a single mailbox to `is_default=true` for the calling
				// member. Validates ownership so a member cannot promote an
				// org-mate's mailbox (or a shared mailbox) into their own primary
				// slot.
				setPrimaryMailbox: (id: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const session = yield* SessionContext

						const target = yield* resolveMailbox(id)
						if (!target) {
							return yield* new NotFound({ entity: 'Mailbox', id })
						}
						if (target.purpose !== 'human') {
							return yield* new BadRequest({
								message: 'Only human mailboxes can be set as primary',
							})
						}
						if (target.ownerUserId !== session.userId) {
							return yield* new BadRequest({
								message: 'Cannot set someone else’s mailbox as primary',
							})
						}
						if (!target.active) {
							return yield* new BadRequest({
								message: 'Cannot set an inactive mailbox as primary',
							})
						}

						yield* sql.withTransaction(
							Effect.gen(function* () {
								yield* sql`
									UPDATE channel_connections
									SET is_default = false, updated_at = now()
									WHERE organization_id = ${currentOrg.id}
									  AND owner_user_id = ${session.userId}
									  AND purpose = 'human'
									  AND is_default = true
									  AND id <> ${id}
								`
								yield* sql`
									UPDATE channel_connections
									SET is_default = true, updated_at = now()
									WHERE id = ${id}
									  AND organization_id = ${currentOrg.id}
								`
							}),
						)
						const refreshed = yield* resolveMailbox(id)
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
							SELECT attachments
							FROM messages
							WHERE organization_id = ${currentOrg.id}
							  AND (id::text = ${messageId} OR message_id = ${messageId})
							LIMIT 1
						`.pipe(Effect.orDie)
						const row = rows[0]
						if (!row) {
							return yield* new NotFound({
								entity: 'EmailMessage',
								id: messageId,
							})
						}

						// Attachment bytes live in object storage under the
						// `storageKey` recorded on the message's attachment metadata;
						// the `attachmentId` URL segment is the array index.
						const idx = Number.parseInt(attachmentId, 10)
						const meta = row.attachments?.[idx]
						if (!meta) {
							return yield* new NotFound({
								entity: 'EmailAttachment',
								id: attachmentId,
							})
						}
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
					}),

				// ── Drafts ──────────────────────────────────────────────────
				// Drafts live in Postgres via DraftStore. The editor block tree
				// is the source of truth; html/text render on send.
				// Threading metadata (mode, threadLinkId, inReplyTo) is real
				// columns now — no clientId-string stuffing.

				createDraft: (
					mailboxId: string,
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
						const mailbox = yield* resolveMailbox(mailboxId)
						if (!mailbox) {
							return yield* new NotFound({ entity: 'Mailbox', id: mailboxId })
						}
						const draft = yield* drafts.create({
							mailboxId: mailbox.id,
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
					mailboxId: string,
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
						const mailbox = yield* resolveMailbox(mailboxId)
						if (!mailbox) {
							return yield* new NotFound({ entity: 'Mailbox', id: mailboxId })
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

				deleteDraft: (mailboxId: string, draftId: string) =>
					Effect.gen(function* () {
						const mailbox = yield* resolveMailbox(mailboxId)
						if (!mailbox) {
							return yield* new NotFound({ entity: 'Mailbox', id: mailboxId })
						}
						yield* staging.sweepForDraft(draftId).pipe(Effect.ignore)
						yield* drafts.remove(draftId)
					}),

				getDraft: (mailboxId: string, draftId: string) =>
					Effect.gen(function* () {
						const mailbox = yield* resolveMailbox(mailboxId)
						if (!mailbox) {
							return yield* new NotFound({ entity: 'Mailbox', id: mailboxId })
						}
						const draft = yield* drafts.get(draftId)
						return draftRowToProviderShape(draft)
					}),

				listDrafts: (mailboxId?: string) =>
					Effect.gen(function* () {
						const list = yield* drafts.list(mailboxId)
						return list
							.map(draftRowToProviderShape)
							.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
					}),

				sendDraft: (mailboxId: string, draftId: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const mailbox = yield* resolveMailbox(mailboxId)
						if (!mailbox) {
							return yield* new NotFound({ entity: 'Mailbox', id: mailboxId })
						}
						yield* assertMailboxUsable(mailbox)

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
								FROM conversations
								WHERE id = ${threadLinkId}
								  AND organization_id = ${currentOrg.id}
								LIMIT 1
							`.pipe(Effect.orDie)
							existingThreadLink = linkRows[0] ?? null
						}

						// Resolve staged attachments for this draft + render the
						// editor block tree to text/html. Footer is appended
						// unconditionally — DraftStore doesn't expose a skipFooter
						// flag yet, so drafts always get the mailbox's default footer.
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
						const staged = yield* staging.resolve(mailbox.id, stagedRefs)
						const footerBlocks = yield* resolveDefaultFooter(mailbox.id)
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
							from: mailbox.email,
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

						const dispatched = yield* dispatchOutbound(mailbox, outbound)
						const result = {
							messageId: dispatched.messageId,
							threadId: existingThreadLink
								? existingThreadLink.externalThreadId
								: dispatched.messageId,
						}

						yield* recordOutbound({
							result,
							mailbox,
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

				listFooters: (mailboxId: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						return yield* sql`
							SELECT * FROM connection_footers
							WHERE connection_id =${mailboxId}
							  AND organization_id = ${currentOrg.id}
							ORDER BY is_default DESC, name
						`
					}).pipe(Effect.orDie),

				getFooter: (id: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const rows = yield* sql`
							SELECT * FROM connection_footers
							WHERE id = ${id}
							  AND organization_id = ${currentOrg.id}
							LIMIT 1
						`
						if (rows.length === 0) {
							return yield* new NotFound({
								entity: 'MailboxFooter',
								id,
							})
						}
						return rows[0]!
					}),

				createFooter: (input: {
					mailboxId: string
					name: string
					bodyJson: EmailBlocks
					isDefault?: boolean
				}) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const mailbox = yield* resolveMailbox(input.mailboxId)
						if (!mailbox) {
							return yield* new NotFound({
								entity: 'Mailbox',
								id: input.mailboxId,
							})
						}
						if (input.isDefault) {
							yield* sql`
								UPDATE connection_footers
								SET is_default = false, updated_at = now()
								WHERE connection_id =${input.mailboxId}
								  AND organization_id = ${currentOrg.id}
								  AND is_default = true
							`
						}
						const rows = yield* sql`
							INSERT INTO connection_footers ${sql.insert({
								organizationId: currentOrg.id,
								connectionId: input.mailboxId,
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
							const existing = yield* sql<{ mailboxId: string }>`
								SELECT connection_id AS "mailboxId" FROM connection_footers
								WHERE id = ${id}
								  AND organization_id = ${currentOrg.id}
								LIMIT 1
							`
							if (existing[0]) {
								yield* sql`
									UPDATE connection_footers
									SET is_default = false, updated_at = now()
									WHERE connection_id =${existing[0].mailboxId}
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
								SELECT * FROM connection_footers
								WHERE id = ${id}
								  AND organization_id = ${currentOrg.id}
								LIMIT 1
							`
							if (r.length === 0) {
								return yield* new NotFound({
									entity: 'MailboxFooter',
									id,
								})
							}
							return r[0]!
						}
						sets.push(sql`updated_at = now()`)
						const rows = yield* sql`
							UPDATE connection_footers
							SET ${sql.csv(sets)}
							WHERE id = ${id}
							  AND organization_id = ${currentOrg.id}
							RETURNING *
						`
						if (rows.length === 0) {
							return yield* new NotFound({
								entity: 'MailboxFooter',
								id,
							})
						}
						return rows[0]!
					}),

				deleteFooter: (id: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						yield* sql`
							DELETE FROM connection_footers
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
