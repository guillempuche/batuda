import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import type { ParsedMail } from 'mailparser'

import { resolveThreadId } from './threading.js'

// Parsed-mail subset the worker reads. Decouples persist from any
// specific parser so a future swap (e.g. mailparser → letterparser) is
// localized.
export interface ParsedInbound {
	readonly messageId: string
	readonly inReplyTo: string | null
	readonly references: readonly string[]
	readonly subject: string | null
	readonly receivedAt: Date
	readonly textBody: string | null
	readonly htmlBody: string | null
	readonly textPreview: string | null
	readonly fromAddress: string | null
	readonly toAddresses: readonly string[]
	readonly ccAddresses: readonly string[]
	readonly bccAddresses: readonly string[]
}

const collectAddresses = (
	addr: ParsedMail['to'] | ParsedMail['cc'] | ParsedMail['bcc'],
): string[] => {
	if (!addr) return []
	const list = Array.isArray(addr) ? addr : [addr]
	const out: string[] = []
	for (const a of list) {
		for (const v of a.value) {
			if (v.address) out.push(v.address.toLowerCase())
		}
	}
	return out
}

// Adapter for `mailparser`'s ParsedMail. Lives next to the worker so
// the row-shape contract above can evolve without touching parser
// internals.
export const fromParsedMail = (mail: ParsedMail): ParsedInbound => {
	const messageId = mail.messageId ?? ''
	const inReplyTo = mail.inReplyTo ?? null
	const references = mail.references
		? Array.isArray(mail.references)
			? mail.references
			: [mail.references]
		: []
	const text = typeof mail.text === 'string' ? mail.text : null
	const preview = text ? text.slice(0, 200) : null
	return {
		messageId,
		inReplyTo,
		references,
		subject: mail.subject ?? null,
		receivedAt: mail.date ?? new Date(),
		textBody: text,
		htmlBody: mail.html === false ? null : (mail.html ?? null),
		textPreview: preview,
		fromAddress: mail.from?.value[0]?.address?.toLowerCase() ?? null,
		toAddresses: collectAddresses(mail.to),
		ccAddresses: collectAddresses(mail.cc),
		bccAddresses: collectAddresses(mail.bcc),
	}
}

// Per-attachment metadata persisted as a JSONB array on email_messages.
// `storageKey` points at the bytes uploaded by `RawMessageStorage.putAttachment`
// — the download path is a single GET, no parse-on-request.
export interface AttachmentMetadata {
	readonly index: number
	readonly filename: string
	readonly contentType: string
	readonly sizeBytes: number
	readonly cid: string | null
	readonly isInline: boolean
	readonly storageKey: string
}

// Insert a parsed inbound message + its participants + (re)link to a
// thread. Caller is responsible for `SET LOCAL app.current_org_id`
// inside the surrounding transaction; the worker connects as
// `app_service` (BYPASSRLS) and resolves org from the inbox row before
// each insert batch.
export const persistInboundMessage = (args: {
	readonly organizationId: string
	readonly inboxId: string
	readonly folder: string
	readonly imapUid: number
	readonly imapUidvalidity: number
	readonly rawRfc822Ref: string
	readonly parsed: ParsedInbound
	readonly attachments: ReadonlyArray<AttachmentMetadata>
}) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient

		const externalThreadId = yield* resolveThreadId({
			organizationId: args.organizationId,
			messageId: args.parsed.messageId,
			inReplyTo: args.parsed.inReplyTo,
			references: args.parsed.references,
		})

		// Upsert thread link first so the message INSERT can reference its
		// `external_thread_id` invariant. Idempotent under the unique
		// `(organization_id, external_thread_id)` index.
		yield* sql`
			INSERT INTO email_thread_links (organization_id, inbox_id, external_thread_id, updated_at)
			VALUES (${args.organizationId}, ${args.inboxId}, ${externalThreadId}, now())
			ON CONFLICT (organization_id, external_thread_id)
			DO UPDATE SET updated_at = now()
		`

		// `idx_email_messages_imap_dedupe` makes the (inbox_id,
		// uidvalidity, uid) tuple unique, so re-fetches of the same UID
		// after a worker restart are no-ops.
		const inserted = yield* sql<{ id: string }>`
			INSERT INTO email_messages (
				organization_id, inbox_id, folder, imap_uid, imap_uidvalidity,
				message_id, in_reply_to, "references",
				subject, received_at, text_body, html_body, text_preview,
				raw_rfc822_ref, recipients, attachments, status, status_updated_at,
				direction
			)
			VALUES (
				${args.organizationId}, ${args.inboxId}, ${args.folder},
				${args.imapUid}, ${args.imapUidvalidity},
				${args.parsed.messageId}, ${args.parsed.inReplyTo},
				${args.parsed.references as unknown as string[]},
				${args.parsed.subject}, ${args.parsed.receivedAt},
				${args.parsed.textBody}, ${args.parsed.htmlBody}, ${args.parsed.textPreview},
				${args.rawRfc822Ref},
				${JSON.stringify({
					to: args.parsed.toAddresses,
					cc: args.parsed.ccAddresses,
					bcc: args.parsed.bccAddresses,
				})}::jsonb,
				${JSON.stringify(args.attachments)}::jsonb,
				'normal', now(),
				'inbound'
			)
			ON CONFLICT (inbox_id, imap_uidvalidity, imap_uid)
			  WHERE imap_uid IS NOT NULL
			DO NOTHING
			RETURNING id
		`
		const messageDbId = inserted[0]?.id
		if (!messageDbId) return { messageId: null }

		// Participant rows — one per (message × address × role). This
		// is the queryable index used for "all messages where contact
		// X was on To/Cc". The IMAP worker fixes the pre-existing gap
		// where role='from' was only written for outbound messages.
		type Row = { messageId: string; address: string; role: string }
		const rows: Row[] = []
		if (args.parsed.fromAddress) {
			rows.push({
				messageId: messageDbId,
				address: args.parsed.fromAddress,
				role: 'from',
			})
		}
		for (const a of args.parsed.toAddresses) {
			rows.push({ messageId: messageDbId, address: a, role: 'to' })
		}
		for (const a of args.parsed.ccAddresses) {
			rows.push({ messageId: messageDbId, address: a, role: 'cc' })
		}
		for (const a of args.parsed.bccAddresses) {
			rows.push({ messageId: messageDbId, address: a, role: 'bcc' })
		}
		if (rows.length > 0) {
			yield* sql`
				INSERT INTO message_participants (email_message_id, email_address, role)
				SELECT v.message_id, v.address, v.role
				FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
				  AS v(message_id uuid, address text, role text)
				ON CONFLICT DO NOTHING
			`
		}

		return { messageId: messageDbId }
	})
