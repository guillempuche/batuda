import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import type { ParsedMail } from 'mailparser'

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
	const value = typeof ct === 'string' ? ct : (ct as { value?: string }).value
	if (!value) return false
	const lower = value.toLowerCase()
	return (
		lower.includes('multipart/report') &&
		lower.includes('report-type=delivery-status')
	)
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

	let recipients: string[] = []
	let statusCode: string | null = null
	let diagnostic: string | null = null
	let originalMessageId: string | null = null

	for (const att of mail.attachments ?? []) {
		const ct = (att.contentType ?? '').toLowerCase()
		const body = att.content?.toString('utf8') ?? ''
		if (ct.startsWith('message/delivery-status')) {
			const parsed = parseDeliveryStatus(body)
			recipients = parsed.recipients
			statusCode = parsed.status
			diagnostic = parsed.diagnostic
		} else if (
			ct.startsWith('message/rfc822') ||
			ct.startsWith('text/rfc822-headers')
		) {
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
// Org isolation: contacts/timeline_activity don't carry organization_id
// in the current schema (multi-org for CRM core is a separate slice).
// We rely on the original email_messages match (already org-scoped) to
// gate everything that follows: only recipients of an email *we sent
// from this org* get touched.
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
		const updatedContacts = yield* sql<{ id: string; companyId: string }>`
			UPDATE contacts
			SET email_status = ${isHard ? 'bounced' : sql.literal('email_status')},
			    email_status_reason = ${bounce.diagnostic},
			    email_status_updated_at = now(),
			    email_soft_bounce_count = CASE
			      WHEN ${isHard} THEN email_soft_bounce_count
			      ELSE email_soft_bounce_count + 1
			    END
			WHERE lower(email) = ANY(${recipients})
			RETURNING id, company_id
		`

		// Soft-bounce promotion: if the rolling 7-day soft bounce count
		// crosses 3, promote to hard bounce. Threshold is checked here
		// rather than in a cron because the DSN arrival is the only
		// natural trigger; idle accounts shouldn't be re-evaluated.
		if (!isHard) {
			yield* sql`
				UPDATE contacts
				SET email_status = 'bounced',
				    email_status_updated_at = now()
				WHERE lower(email) = ANY(${recipients})
				  AND email_soft_bounce_count >= 3
				  AND email_status_updated_at >= now() - interval '7 days'
			`
		}

		// One activity row per affected contact (so the bounce shows on
		// each contact's timeline). When no contact matched a recipient,
		// emit a single contact-less row so the bounce isn't silent.
		const payload = JSON.stringify({
			originalMessageId: bounce.originalMessageId,
			status: bounce.statusCode,
			diagnostic: bounce.diagnostic,
			recipients: [...bounce.recipients],
			bounceType: bounce.bounceType,
		})

		if (updatedContacts.length > 0) {
			yield* sql`
				INSERT INTO timeline_activity (
					kind, entity_type, entity_id, company_id, contact_id,
					channel, direction, occurred_at, payload
				)
				SELECT 'email_bounced', 'email_message', ${originalId}::uuid,
				       c.company_id, c.id,
				       'email', 'outbound', now(), ${payload}::jsonb
				FROM contacts c
				WHERE c.id = ANY(${updatedContacts.map(r => r.id) as unknown as string[]})
			`
		} else {
			yield* sql`
				INSERT INTO timeline_activity (
					kind, entity_type, entity_id,
					channel, direction, occurred_at, payload
				)
				VALUES (
					'email_bounced', 'email_message', ${originalId}::uuid,
					'email', 'outbound', now(), ${payload}::jsonb
				)
			`
		}

		return {
			matchedOriginal: true,
			contactsTouched: updatedContacts.length,
		}
	})
