import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'
import type { EmailBlocks } from '@batuda/email/schema'

import { CalendarService } from './calendar.js'
import { EmailService } from './email.js'

// Composes `calendar.forwardInvitation` (builds REQUEST bytes) with
// `email.send` (sends them) from the outside so CalendarService does
// not take a dependency on EmailService — same cycle-avoidance split
// as `calendar-rsvp-dispatch.ts`.
export const dispatchForwardInvitation = (args: {
	readonly calendarEventId: string
	readonly toEmail: string
	readonly note: string | null
}) =>
	Effect.gen(function* () {
		const calendar = yield* CalendarService
		const email = yield* EmailService
		const sql = yield* SqlClient.SqlClient
		const currentOrg = yield* CurrentOrg

		const { ics } = yield* calendar.forwardInvitation(args)

		// Re-load the event so we have title, company, and the
		// source-email breadcrumb for inbox selection.
		const eventRows = yield* sql<{
			id: string
			title: string
			source: 'booking' | 'email' | 'internal'
			companyId: string | null
			metadata: Record<string, unknown> | null
		}>`
			SELECT id, title, source, company_id AS "companyId", metadata
			FROM calendar_events
			WHERE id = ${args.calendarEventId}
			LIMIT 1
		`
		const event = eventRows[0]
		if (!event) {
			yield* Effect.logWarning(
				'forward_invitation called on missing event after bytes built',
			).pipe(
				Effect.annotateLogs({
					event: 'calendar.forward_missing_event',
					calendarEventId: args.calendarEventId,
				}),
			)
			return { ics }
		}

		// For email-sourced events the cleanest inbox to forward from is
		// the one that received the original invitation. For booking and
		// internal events we fall back to the user's default inbox. If
		// neither resolves, return the bytes without sending so the caller
		// can decide.
		const meta = event.metadata ?? null
		const sourceEmailMessageId =
			meta && typeof meta === 'object' && 'sourceEmailMessageId' in meta
				? (meta as { sourceEmailMessageId?: unknown }).sourceEmailMessageId
				: null
		let inboxId: string | null = null
		if (
			typeof sourceEmailMessageId === 'string' &&
			sourceEmailMessageId.length > 0
		) {
			const messageRows = yield* sql<{ inboxId: string | null }>`
				SELECT inbox_id AS "inboxId"
				FROM email_messages
				WHERE id = ${sourceEmailMessageId}
				  AND organization_id = ${currentOrg.id}
				LIMIT 1
			`
			inboxId = messageRows[0]?.inboxId ?? null
		}
		if (!inboxId) {
			const fallbackRows = yield* sql<{ id: string }>`
				SELECT id FROM inboxes
				WHERE organization_id = ${currentOrg.id}
				  AND active = true
				ORDER BY created_at ASC
				LIMIT 1
			`
			inboxId = fallbackRows[0]?.id ?? null
		}
		if (!inboxId) {
			yield* Effect.logWarning(
				'forward_invitation bytes built but no inbox available to send',
			).pipe(
				Effect.annotateLogs({
					event: 'calendar.forward_no_inbox',
					calendarEventId: args.calendarEventId,
				}),
			)
			return { ics }
		}

		// If the recipient matches a contact, we pass the contactId so
		// the suppression check + outbound log stay wired up the same
		// way as any other agent-sent email.
		const contactRows = yield* sql<{ id: string; companyId: string | null }>`
			SELECT id, company_id AS "companyId"
			FROM contacts
			WHERE organization_id = ${currentOrg.id}
			  AND lower(email) = ${args.toEmail.toLowerCase()}
			ORDER BY created_at ASC
			LIMIT 1
		`
		const contactId = contactRows[0]?.id ?? null
		const companyId = event.companyId ?? contactRows[0]?.companyId ?? null

		// Without a companyId there is no outbound-log anchor; skip the
		// send rather than fabricate one. Forwarded events without a
		// company association are rare (internal blocks forwarded to an
		// outsider) and the caller can still ship the bytes manually.
		if (!companyId) {
			yield* Effect.logWarning(
				'forward_invitation bytes built but no companyId to attach',
			).pipe(
				Effect.annotateLogs({
					event: 'calendar.forward_no_company',
					calendarEventId: args.calendarEventId,
				}),
			)
			return { ics }
		}

		const trimmedNote = args.note?.trim() ?? ''
		const paragraphs: EmailBlocks = [
			...(trimmedNote.length > 0
				? [
						{
							type: 'paragraph' as const,
							spans: [{ kind: 'text' as const, value: trimmedNote }],
						},
					]
				: []),
			{
				type: 'paragraph' as const,
				spans: [
					{ kind: 'text' as const, value: 'Meeting invitation attached.' },
				],
			},
		]

		const sendResult = yield* email
			.send(
				inboxId,
				args.toEmail,
				`Fwd: ${event.title}`,
				paragraphs,
				companyId,
				contactId ?? undefined,
				{
					rawAttachments: [
						{
							filename: 'invite.ics',
							contentType: 'text/calendar; method=REQUEST; charset=UTF-8',
							contentBase64: Buffer.from(ics).toString('base64'),
							disposition: 'attachment',
						},
					],
				},
			)
			.pipe(
				Effect.map(r => ({
					messageId: r.messageId as string | null,
					threadId: r.threadId as string | null,
				})),
				Effect.catchCause(cause =>
					Effect.gen(function* () {
						yield* Effect.logWarning(
							'forward_invitation email send failed',
						).pipe(
							Effect.annotateLogs({
								event: 'calendar.forward_send_failed',
								calendarEventId: args.calendarEventId,
								toEmail: args.toEmail,
								cause: String(cause),
							}),
						)
						return {
							messageId: null as string | null,
							threadId: null as string | null,
						}
					}),
				),
			)

		return { ics, ...sendResult }
	})
