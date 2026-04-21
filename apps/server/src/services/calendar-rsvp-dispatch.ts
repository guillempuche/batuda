import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

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
		}>`
			SELECT metadata
			FROM calendar_events
			WHERE id = ${args.calendarEventId}
			LIMIT 1
		`
		const meta = eventRows[0]?.metadata ?? null
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
		const messageRows = yield* sql<{ providerThreadId: string }>`
			SELECT provider_thread_id
			FROM email_messages
			WHERE id = ${sourceEmailMessageId}
			LIMIT 1
		`
		const providerThreadId = messageRows[0]?.providerThreadId
		if (!providerThreadId) {
			yield* Effect.logWarning(
				'RSVP reply bytes produced but email message row missing',
			).pipe(
				Effect.annotateLogs({
					event: 'calendar.rsvp_reply_missing_message',
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
			.reply(providerThreadId, body, {
				skipFooter: true,
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
							providerThreadId,
							cause: String(cause),
						}),
					),
				),
			)

		return result
	})
