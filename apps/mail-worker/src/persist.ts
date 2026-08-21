import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import type { ParsedMail } from 'mailparser'

import { CurrentOrg } from '@batuda/domain'
import { NoMatch, ParticipantMatcher } from '@batuda/email/participant-matcher'

import { resolveThreadId } from './threading.js'

// Whether an id is one a conversation can be keyed on.
//
// A conversation is identified by a single id, and there is one row per id per
// organisation — so an id that many unrelated messages share is not an
// identifier at all, it is a bucket they all fall into. Senders emit plenty of
// those: an empty `<>`, a header mangled into prose ("Your message of Tue…"),
// two ids run together by a stray comma. Adopting one of those would put every
// message in the organisation carrying the same junk into a single
// conversation, mixing unrelated people's mail together.
//
// So the shape is checked before it is trusted: something inside the brackets,
// nothing that belongs to more than one id, and the `@` that RFC 5322 requires.
// Anything failing that is passed over for the next candidate.
const isUsableMessageId = (id: string | null | undefined): id is string => {
	if (typeof id !== 'string') return false
	const core = id.trim().replace(/^</, '').replace(/>$/, '').trim()
	return core !== '' && !/[\s<>,]/.test(core) && core.includes('@')
}

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
	const headerReferences = mail.references
		? Array.isArray(mail.references)
			? mail.references
			: [mail.references]
		: []
	// A message that answers something but carries no References header stands
	// its In-Reply-To in for the chain, which is what RFC 5322 says to do and
	// what mail clients do. Without it the row belongs to no conversation at
	// all: which conversation a message is in is read from this list, so a
	// reply that arrives this way is filed correctly and then never shown,
	// never counted, and never marks the thread unread.
	const references =
		headerReferences.length > 0
			? headerReferences
			: isUsableMessageId(inReplyTo)
				? [inReplyTo]
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

// Insert a parsed message + its participants + (re)link to a thread.
// Caller is responsible for `SET LOCAL app.current_org_id` inside the
// surrounding transaction; the worker connects as `app_service`
// (BYPASSRLS) and resolves org from the inbox row before each insert batch.
//
// Which way the message went is the caller's to say, because only it knows
// what the folder it was read from is for.
export const persistMessage = (args: {
	readonly organizationId: string
	readonly inboxId: string
	readonly folder: string
	readonly direction: 'inbound' | 'outbound'
	readonly imapUid: number
	readonly imapUidvalidity: number
	readonly rawRfc822Ref: string
	readonly parsed: ParsedInbound
	readonly attachments: ReadonlyArray<AttachmentMetadata>
}) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const matcher = yield* ParticipantMatcher

		// A message we sent, coming back to us out of the sent folder. It is
		// already recorded, with no folder position yet, and all that is new is
		// where it now lives on the server, so we fill that in rather than
		// storing it a second time. Trying to insert it would be turned away
		// for reusing a Message-ID, and that refusal would undo the whole
		// batch, not just this message.
		//
		// Such a row already has its participants and its place in the
		// company's history, so this stops here.
		const enriched = yield* sql<{ id: string }>`
			UPDATE email_messages
			SET imap_uid = ${args.imapUid},
			    imap_uidvalidity = ${args.imapUidvalidity},
			    folder = ${args.folder},
			    attachments = CASE
			      WHEN attachments = '[]'::jsonb
			      THEN ${JSON.stringify(args.attachments)}::jsonb
			      ELSE attachments
			    END,
			    text_body = COALESCE(text_body, ${args.parsed.textBody}),
			    html_body = COALESCE(html_body, ${args.parsed.htmlBody}),
			    text_preview = COALESCE(text_preview, ${args.parsed.textPreview})
			WHERE organization_id = ${args.organizationId}
			  AND message_id = ${args.parsed.messageId}
			  AND inbox_id = ${args.inboxId}
			  AND direction = 'outbound'
			  AND imap_uid IS NULL
			RETURNING id
		`
		const enrichedId = enriched[0]?.id
		if (enrichedId !== undefined) return { messageId: enrichedId }

		const externalThreadId = yield* resolveThreadId({
			organizationId: args.organizationId,
			messageId: args.parsed.messageId,
			inReplyTo: args.parsed.inReplyTo,
			references: args.parsed.references,
		})

		// Which conversation a message is in is read back out of this list, so
		// the conversation's own id has to be in it or the message belongs
		// nowhere a reader looks — filed correctly and then never shown, never
		// counted, never marking the conversation unread.
		//
		// A sender that names only the message it answers, and not the whole
		// chain back to the start, leaves it out. So does a sender that trims a
		// long chain. Both are ordinary. The id goes in front, where the oldest
		// ancestor belongs.
		const storedReferences = args.parsed.references.includes(externalThreadId)
			? args.parsed.references
			: [externalThreadId, ...args.parsed.references]

		// Whose conversation this is comes from the other side of it: who wrote
		// to us, or who we wrote to. Reading the sender of a message we sent
		// would only ever find ourselves, and a conversation that starts
		// unmatched is never re-homed — so a thread first seen in the sent
		// folder would stay off that company's page even after they reply.
		const counterpartAddress =
			args.direction === 'outbound'
				? (args.parsed.toAddresses[0] ?? null)
				: args.parsed.fromAddress

		// Resolve that address → contact/company once, then carry the IDs onto
		// both the thread link and the message row. `createPolicy: 'never'`
		// keeps this passive: an unknown address stays an orphan, never
		// auto-creates a contact. The matcher only reads `currentOrg.id`
		// (not name/slug), so a thin record is sufficient — providing the
		// full org would mean a second round-trip we don't need.
		const match = counterpartAddress
			? yield* matcher
					.match({
						email: counterpartAddress,
						createPolicy: 'never',
					})
					.pipe(
						Effect.provideService(CurrentOrg, {
							id: args.organizationId,
							name: '',
							slug: '',
							// Delivering mail is nobody's request, so it manages nothing.
							role: null,
						}),
					)
			: new NoMatch({ email: '' })

		// Ambiguous and NoMatch deliberately fall through to null on both
		// IDs — we never pick a winner when the address resolves to more
		// than one contact.
		const companyId =
			match._tag === 'MatchedContact' ||
			match._tag === 'MatchedCompanyOnly' ||
			match._tag === 'CreatedContact' ||
			match._tag === 'CreatedBoth'
				? match.companyId
				: null
		const contactId =
			match._tag === 'MatchedContact' ||
			match._tag === 'CreatedContact' ||
			match._tag === 'CreatedBoth'
				? match.contactId
				: null

		// Upsert thread link first so the message INSERT can reference its
		// `external_thread_id` invariant. Idempotent under the unique
		// `(organization_id, external_thread_id)` index. The DO UPDATE
		// clause deliberately leaves `company_id`/`contact_id` alone —
		// the first message on a thread sets the link, later messages
		// from a different sender don't re-home the whole thread. The subject
		// is filled in only when the thread hasn't got one, so a later message
		// can't rename the conversation — replies to it are sent with this
		// subject, so it has to stay put. The id comes back so the history
		// entry can point at the conversation this message belongs to.
		const threadLinks = yield* sql<{ id: string }>`
			INSERT INTO email_thread_links (organization_id, inbox_id, external_thread_id, company_id, contact_id, subject, updated_at)
			VALUES (${args.organizationId}, ${args.inboxId}, ${externalThreadId}, ${companyId}, ${contactId}, ${args.parsed.subject}, now())
			ON CONFLICT (organization_id, external_thread_id)
			DO UPDATE SET updated_at = now(),
			              subject = COALESCE(NULLIF(btrim(email_thread_links.subject), ''), NULLIF(btrim(EXCLUDED.subject), ''))
			RETURNING id
		`
		const threadLinkId = threadLinks[0]?.id ?? null

		// A message we already hold is left alone. Which rule says so is
		// deliberately not named: reading the same folder position twice is one
		// way, and meeting a Message-ID the organization already has is another
		// — the same address on two mailboxes, say. Naming one of them would
		// mean the other is refused instead, and a refusal here undoes the
		// whole batch rather than skipping the one message.
		const inserted = yield* sql<{ id: string }>`
			INSERT INTO email_messages (
				organization_id, inbox_id, folder, imap_uid, imap_uidvalidity,
				message_id, in_reply_to, "references",
				subject, received_at, text_body, html_body, text_preview,
				raw_rfc822_ref, recipients, attachments, status, status_updated_at,
				direction, company_id, contact_id
			)
			VALUES (
				${args.organizationId}, ${args.inboxId}, ${args.folder},
				${args.imapUid}, ${args.imapUidvalidity},
				${args.parsed.messageId}, ${args.parsed.inReplyTo},
				${storedReferences as unknown as string[]},
				${args.parsed.subject}, ${args.parsed.receivedAt},
				${args.parsed.textBody}, ${args.parsed.htmlBody}, ${args.parsed.textPreview},
				${args.rawRfc822Ref},
				${JSON.stringify({
					// Who it came from, kept alongside who it went to. A reply is
					// addressed to the sender of what it answers, and on an inbound
					// message the `to` is our own mailbox — so without this the only
					// address on file to reply to is ours.
					from: args.parsed.fromAddress,
					to: args.parsed.toAddresses,
					cc: args.parsed.ccAddresses,
					bcc: args.parsed.bccAddresses,
				})}::jsonb,
				${JSON.stringify(args.attachments)}::jsonb,
				'normal', now(),
				${args.direction}, ${companyId}, ${contactId}
			)
			ON CONFLICT DO NOTHING
			RETURNING id
		`
		const messageDbId = inserted[0]?.id
		if (!messageDbId) return { messageId: null }

		// Participant rows — one per (message × address × role). This
		// is the queryable index used for "all messages where contact
		// X was on To/Cc". jsonb_to_recordset matches JSON keys to
		// recordset columns by exact (case-sensitive) name, and
		// Postgres folds unquoted column identifiers to lowercase, so
		// the JSON keys must be lowercase snake_case to match
		// `message_id`/`address`/`role`.
		type Row = { message_id: string; address: string; role: string }
		const rows: Row[] = []
		if (args.parsed.fromAddress) {
			rows.push({
				message_id: messageDbId,
				address: args.parsed.fromAddress,
				role: 'from',
			})
		}
		for (const a of args.parsed.toAddresses) {
			rows.push({ message_id: messageDbId, address: a, role: 'to' })
		}
		for (const a of args.parsed.ccAddresses) {
			rows.push({ message_id: messageDbId, address: a, role: 'cc' })
		}
		for (const a of args.parsed.bccAddresses) {
			rows.push({ message_id: messageDbId, address: a, role: 'bcc' })
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

		// Put the reply on the company's history, so the timeline shows what
		// they answered and not only what we sent. Skipped when the sender
		// matched no company: the history is read one company at a time, and
		// a thread that starts unmatched is never re-homed, so nobody could
		// ever reach such a row. The message itself is still stored.
		//
		// Only for mail that arrived: the sender of a message in the sent
		// folder is us, so filing it here would show our own message as
		// something the company said to us.
		if (companyId && args.direction === 'inbound') {
			yield* sql`
				INSERT INTO timeline_activity (
					organization_id, kind, entity_type, entity_id, company_id, contact_id,
					channel, direction, occurred_at, summary, payload
				)
				VALUES (
					${args.organizationId}, 'email_received', 'email_message',
					${messageDbId}::uuid, ${companyId}, ${contactId},
					'email', 'inbound', ${args.parsed.receivedAt},
					${args.parsed.textPreview},
					${JSON.stringify({
						subject: args.parsed.subject,
						classification: 'normal',
						threadLinkId,
					})}::jsonb
				)
			`

			// The company page reads these dates as stored values rather than
			// working them out on the fly, so an arriving reply has to move
			// them here or the page keeps showing the older outbound date.
			yield* sql`
				UPDATE companies SET
					last_email_at = GREATEST(last_email_at, ${args.parsed.receivedAt}),
					last_contacted_at = GREATEST(last_contacted_at, ${args.parsed.receivedAt}),
					updated_at = now()
				WHERE id = ${companyId} AND deleted_at IS NULL
			`
		}

		return { messageId: messageDbId }
	})
