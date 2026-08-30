import { DateTime, Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import type { ParsedMail } from 'mailparser'

import { EmailBounced, TimelineActivityService } from '@batuda/timeline'

import { asOrg } from './lib/as-org.js'

// RFC 3464 Delivery Status Notification parsing. A DSN is a
// multipart/report;report-type=delivery-status with three parts:
//   1. text/plain — human-readable explanation
//   2. message/delivery-status — machine-readable per-recipient status
//   3. message/rfc822 (or text/rfc822-headers) — the original message
// We only ever read part (2) for status codes and part (3) for the
// original RFC Message-ID. Part (1) is ignored on the parse side; the
// DSN itself is still persisted as a normal email_messages row so it
// surfaces in the inbox list.

export interface ParsedBounce {
	readonly originalMessageId: string | null
	readonly recipients: readonly string[]
	readonly statusCode: string | null // e.g. "5.1.1"
	readonly diagnostic: string | null
	readonly bounceType: 'hard' | 'soft' | 'unknown'
}

const isDsn = (mail: ParsedMail): boolean => {
	const ct = mail.headers.get('content-type')
	if (!ct) return false
	if (typeof ct === 'string') {
		const lower = ct.toLowerCase()
		return (
			lower.includes('multipart/report') &&
			lower.includes('report-type=delivery-status')
		)
	}
	// mailparser parses Content-Type into { value, params } — the report-type
	// parameter is not part of `value`, so we must read it from `params`.
	const parsed = ct as {
		value?: string
		params?: Record<string, string | undefined>
	}
	const value = parsed.value?.toLowerCase() ?? ''
	const reportType = parsed.params?.['report-type']?.toLowerCase()
	return value === 'multipart/report' && reportType === 'delivery-status'
}

const parseDeliveryStatus = (
	body: string,
): {
	recipients: string[]
	status: string | null
	diagnostic: string | null
} => {
	// RFC 3464 fields are RFC822-style headers with a blank-line separator
	// between the per-message group and each per-recipient group. We parse
	// them in one pass since we only need a flat union of fields.
	const recipients: string[] = []
	let status: string | null = null
	let diagnostic: string | null = null

	const stripAddrType = (raw: string): string => {
		// "rfc822;user@example.com" → "user@example.com"
		const semi = raw.indexOf(';')
		const value = semi >= 0 ? raw.slice(semi + 1) : raw
		return value.trim().replace(/^<|>$/g, '').toLowerCase()
	}

	const lines = body.split(/\r?\n/)
	for (const line of lines) {
		const colon = line.indexOf(':')
		if (colon < 0) continue
		const name = line.slice(0, colon).trim().toLowerCase()
		const value = line.slice(colon + 1).trim()
		if (name === 'final-recipient' || name === 'original-recipient') {
			const addr = stripAddrType(value)
			if (addr.length > 0 && !recipients.includes(addr)) {
				recipients.push(addr)
			}
		} else if (name === 'status' && status === null) {
			status = value
		} else if (name === 'diagnostic-code' && diagnostic === null) {
			diagnostic = value.slice(0, 500)
		}
	}
	return { recipients, status, diagnostic }
}

const extractOriginalMessageId = (body: string): string | null => {
	// Either part may be the original. We take the first Message-ID we
	// see that looks RFC 5322 shaped; subsequent ones (e.g. from a
	// quoted forward chain) are noise.
	const match = body.match(/^message-id:\s*(<[^>]+>)/im)
	return match?.[1] ?? null
}

// Best-effort DSN parse. Returns `null` when the message isn't a DSN
// (so the caller can fall back to the normal persist path) or when the
// DSN is too malformed to act on (unmatched parts, missing original).
export const parseBounce = (mail: ParsedMail): ParsedBounce | null => {
	if (!isDsn(mail)) return null

	// simpleParser flattens the message/delivery-status part into `mail.text`
	// alongside the human-readable text/plain explanation. Scanning the
	// concatenated text still works because the parser only matches lines
	// that look like RFC 3464 headers (`Final-Recipient:`, `Status:`, etc.).
	const {
		recipients,
		status: statusCode,
		diagnostic,
	} = parseDeliveryStatus(mail.text ?? '')

	let originalMessageId: string | null = null
	for (const att of mail.attachments ?? []) {
		const ct = (att.contentType ?? '').toLowerCase()
		if (
			ct.startsWith('message/rfc822') ||
			ct.startsWith('text/rfc822-headers')
		) {
			const body = att.content?.toString('utf8') ?? ''
			originalMessageId = extractOriginalMessageId(body) ?? originalMessageId
		}
	}

	const bounceType: 'hard' | 'soft' | 'unknown' = statusCode?.startsWith('5.')
		? 'hard'
		: statusCode?.startsWith('4.')
			? 'soft'
			: 'unknown'

	return {
		originalMessageId,
		recipients,
		statusCode,
		diagnostic,
		bounceType,
	}
}

// Apply a parsed bounce to the database: flip the original outbound
// message to status='bounced', mark the contact rows that bounced, and
// emit an `email_bounced` row on the timeline. The DSN itself is still
// persisted by the regular inbound path so users see "Mail Delivery
// Subsystem" as a normal entry in the inbox list.
//
// Org isolation: every statement here names this org explicitly — the
// email_messages match, the channels update, and the timeline_activity
// insert, which writes the org onto each row. Only recipients of an email
// *we sent from this org* get touched.
export const applyBounce = (args: {
	readonly organizationId: string
	readonly bounce: ParsedBounce
}) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const { bounce, organizationId } = args

		if (!bounce.originalMessageId || bounce.recipients.length === 0) {
			return { matchedOriginal: false, contactsTouched: 0 }
		}

		const originals = yield* sql<{ id: string }>`
			UPDATE email_messages
			SET status = 'bounced',
			    bounce_type = ${bounce.bounceType === 'unknown' ? null : bounce.bounceType},
			    bounce_sub_type = ${bounce.statusCode},
			    status_updated_at = now()
			WHERE organization_id = ${organizationId}
			  AND message_id = ${bounce.originalMessageId}
			RETURNING id
		`
		if (originals.length === 0) {
			return { matchedOriginal: false, contactsTouched: 0 }
		}
		const originalId = originals[0]!.id

		const isHard = bounce.bounceType === 'hard'
		const recipients = bounce.recipients as unknown as string[]
		// Suppression lives on the email channel now; match by address and
		// scope to this org explicitly (the worker runs BYPASSRLS).
		//
		// Asked of the address, not of whoever holds it. A company's orders
		// mailbox and a branch's own address bounce exactly like a person's, and
		// while this only marked the rows belonging to contacts, those never came
		// back suppressed — so mail kept going to a mailbox the far end had
		// already said was not there. The send gate looks a bounced address up
		// across the whole organisation without asking whose it is, so marking
		// them all is what it was expecting to find.
		const suppressed = yield* sql<{
			subjectTable: string
			subjectId: string
		}>`
			UPDATE channels ch
			SET status = ${isHard ? 'bounced' : sql.literal('status')},
			    status_reason = ${bounce.diagnostic},
			    status_updated_at = now(),
			    soft_bounce_count = CASE
			      WHEN ${isHard} THEN ch.soft_bounce_count
			      ELSE ch.soft_bounce_count + 1
			    END
			WHERE ch.channel = 'email'
			  AND ch.organization_id = ${organizationId}
			  AND lower(ch.address) = ANY(${recipients})
			RETURNING ch.subject_table, ch.subject_id
		`

		// A bounce shows on a person's timeline, so the people among them are
		// picked out here. An address belonging to a company or a branch is
		// suppressed just the same and simply has no personal timeline to appear
		// on; the contact-less row below is what carries it.
		const bouncedContactIds = suppressed
			.filter(row => row.subjectTable === 'contacts')
			.map(row => row.subjectId)
		const updatedContacts =
			bouncedContactIds.length === 0
				? []
				: yield* sql<{ id: string; companyId: string }>`
						SELECT c.id, c.company_id FROM contacts c
						WHERE c.id = ANY(${bouncedContactIds as unknown as string[]})
					`

		// Soft-bounce promotion: if the rolling 7-day soft bounce count
		// crosses 3, promote to hard bounce. Threshold is checked here
		// rather than in a cron because the DSN arrival is the only
		// natural trigger; idle accounts shouldn't be re-evaluated.
		if (!isHard) {
			yield* sql`
				UPDATE channels
				SET status = 'bounced',
				    status_updated_at = now()
				WHERE channel = 'email'
				  AND organization_id = ${organizationId}
				  AND lower(address) = ANY(${recipients})
				  AND soft_bounce_count >= 3
				  AND status_updated_at >= now() - interval '7 days'
			`
		}

		// One entry per person it could not reach, so the failure shows on each
		// of their cards; one against nobody in particular when the address
		// belongs to no contact, because a send that failed is worth saying so
		// either way.
		const timeline = yield* TimelineActivityService
		const inOrg = asOrg(organizationId)
		const bouncedAt = DateTime.toDateUtc(DateTime.nowUnsafe())
		const bounced = (companyId: string | null, contactId: string | null) =>
			timeline
				.record(
					new EmailBounced({
						emailMessageId: originalId,
						companyId,
						contactId,
						originalMessageId: bounce.originalMessageId,
						bounceType: bounce.bounceType,
						status: bounce.statusCode,
						diagnostic: bounce.diagnostic,
						recipients: [...bounce.recipients],
						occurredAt: bouncedAt,
					}),
				)
				.pipe(inOrg)

		if (updatedContacts.length > 0) {
			for (const contact of updatedContacts) {
				yield* bounced(contact.companyId, contact.id)
			}
		} else {
			yield* bounced(null, null)
		}

		return {
			matchedOriginal: true,
			contactsTouched: updatedContacts.length,
		}
	})
