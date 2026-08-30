import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'
import type { EmailBlocks } from '@batuda/email/schema'

import { CalendarService } from './calendar.js'
import { EmailService } from './email.js'

// Composes `calendar.respondToRsvp` (builds REPLY bytes) with
// `email.reply` (sends them) from the outside so CalendarService does
// not take a dependency on EmailService — without this split the two
// services would cycle.
export const dispatchRsvpReply = (args: {
	readonly calendarEventId: string
	readonly attendeeEmail: string
	readonly rsvp: 'accepted' | 'declined' | 'tentative'
	readonly comment: string | null
	readonly actorUserId: string | null
}) =>
	Effect.gen(function* () {
		const calendar = yield* CalendarService
		const email = yield* EmailService
		const sql = yield* SqlClient.SqlClient
		const currentOrg = yield* CurrentOrg

		const result = yield* calendar.respondToRsvp(args)

		// Only email-sourced events produce REPLY bytes. For booking
		// events, the provider already handled the RSVP upstream; for
		// internal events, respondToRsvp failed earlier with
		// InvalidRsvpTarget. So a null replyIcs means "no outbound
		// email needed" — no log, no warning.
		if (!result.replyIcs) return result

		// metadata.sourceEmailMessageId is the breadcrumb ICS ingest
		// wrote during the inbound webhook. Without it there's no
		// thread to reply to, which is surprising for a REPLY — log
		// and move on rather than failing the RSVP.
		const eventRows = yield* sql<{
			metadata: Record<string, unknown> | null
			title: string | null
		}>`
			SELECT metadata, title
			FROM calendar_events
			WHERE id = ${args.calendarEventId}
			LIMIT 1
		`
		const meta = eventRows[0]?.metadata ?? null
		// An invitation thread nearly always carries a subject to answer under,
		// but this reply has to go out either way — an accept nobody receives
		// reads to the organiser as no answer at all.
		const eventTitle = eventRows[0]?.title ?? null
		const sourceEmailMessageId =
			meta && typeof meta === 'object' && 'sourceEmailMessageId' in meta
				? (meta as { sourceEmailMessageId?: unknown }).sourceEmailMessageId
				: null
		if (
			typeof sourceEmailMessageId !== 'string' ||
			sourceEmailMessageId.length === 0
		) {
			yield* Effect.logWarning(
				'RSVP reply bytes produced but source email message id missing',
			).pipe(
				Effect.annotateLogs({
					event: 'calendar.rsvp_reply_no_source_message',
					calendarEventId: args.calendarEventId,
				}),
			)
			return result
		}
		// Hop from the source message row to its local thread link via
		// the Message-ID / References pair the IMAP worker stored. The
		// service-side `email.reply` takes the local link UUID, not the
		// RFC thread id.
		const linkRows = yield* sql<{ id: string }>`
			SELECT etl.id
			FROM email_messages em
			JOIN email_thread_links etl
			  ON etl.organization_id = em.organization_id
			 AND (
			   etl.external_thread_id = em.message_id
			   OR etl.external_thread_id = ANY(em."references")
			 )
			WHERE em.id = ${sourceEmailMessageId}
			  AND em.organization_id = ${currentOrg.id}
			-- A conversation can hold more than one of these rows when its
			-- first message was taken in after a reply that named it, so pick
			-- deterministically rather than whichever comes back first. A
			-- references chain runs oldest first, so the earliest entry that
			-- has a conversation is the conversation — the message's own id
			-- would name the later split instead, which holds only the tail.
			ORDER BY array_position(em."references", etl.external_thread_id)
			           ASC NULLS LAST,
			         etl.created_at ASC, etl.id ASC
			LIMIT 1
		`
		const threadLinkId = linkRows[0]?.id
		if (!threadLinkId) {
			yield* Effect.logWarning(
				'RSVP reply bytes produced but thread link row missing',
			).pipe(
				Effect.annotateLogs({
					event: 'calendar.rsvp_reply_missing_thread_link',
					calendarEventId: args.calendarEventId,
					sourceEmailMessageId,
				}),
			)
			return result
		}

		const rsvpLabel =
			args.rsvp === 'accepted'
				? 'Accepted.'
				: args.rsvp === 'declined'
					? 'Declined.'
					: 'Tentative.'
		const paragraphTexts: string[] = [rsvpLabel]
		const trimmedComment = args.comment?.trim() ?? ''
		if (trimmedComment.length > 0) paragraphTexts.push(trimmedComment)
		const body: EmailBlocks = paragraphTexts.map(text => ({
			type: 'paragraph' as const,
			spans: [{ kind: 'text' as const, value: text }],
		}))

		yield* email
			.reply(threadLinkId, body, {
				// Named on the message they answered, but not reaching out — an
				// accept is a reply to somebody else's invitation, so it never
				// takes the lead.
				actor:
					args.actorUserId === null
						? null
						: {
								userId: args.actorUserId,
								isAgent: false,
								claimsLead: false,
							},
				skipFooter: true,
				...(eventTitle !== null &&
					eventTitle.trim() !== '' && { fallbackSubject: eventTitle }),
				rawAttachments: [
					{
						filename: 'invite.ics',
						contentType: 'text/calendar; method=REPLY; charset=UTF-8',
						contentBase64: Buffer.from(result.replyIcs).toString('base64'),
						disposition: 'attachment',
					},
				],
			})
			.pipe(
				Effect.catchCause(cause =>
					Effect.logWarning('RSVP reply email dispatch failed').pipe(
						Effect.annotateLogs({
							event: 'calendar.rsvp_reply_send_failed',
							calendarEventId: args.calendarEventId,
							threadLinkId,
							cause: String(cause),
						}),
					),
				),
			)

		return result
	})
