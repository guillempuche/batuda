import type { SqlClient, Statement } from 'effect/unstable/sql'

import type {
	EmailBounceType,
	EmailDirection,
	EmailMessageStatus,
	ThreadSort,
	ThreadStatus,
	ThreadWaitingOn,
} from '@batuda/domain'

import { ownerCondition } from '../lib/owner-filter'
import { asPlainText } from '../lib/search-text'
import { inThread } from './email-threading-sql'

/**
 * What a list of conversations, or of message records, can be narrowed by.
 *
 * The rules live here rather than inside the service so that the list's own
 * columns and the filters over them are written once: a conversation the list
 * calls unread is exactly one the unread filter finds.
 */

export interface ThreadFilters {
	readonly inboxId?: string | undefined
	readonly companyId?: string | undefined
	readonly contactId?: string | undefined
	readonly status?: ReadonlyArray<ThreadStatus> | undefined
	readonly waitingOn?: ThreadWaitingOn | undefined
	readonly unread?: boolean | undefined
	readonly quietDays?: number | undefined
	readonly lastMessageAfter?: string | undefined
	readonly lastMessageBefore?: string | undefined
	readonly participant?: string | undefined
	readonly hasAttachments?: boolean | undefined
	readonly companyOwner?: ReadonlyArray<string> | undefined
	readonly query?: string | undefined
	readonly sort?: ThreadSort | undefined
}

export interface MessageFilters {
	readonly contactId?: string | undefined
	readonly companyId?: string | undefined
	readonly inboxId?: string | undefined
	readonly status?: ReadonlyArray<EmailMessageStatus> | undefined
	readonly direction?: EmailDirection | undefined
	readonly bounceType?: EmailBounceType | undefined
	readonly receivedAfter?: string | undefined
	readonly receivedBefore?: string | undefined
	readonly participant?: string | undefined
	readonly query?: string | undefined
}

/** Values somebody left blank are nobody asking, not a filter nothing can meet. */
const asked = (
	values: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> | undefined => {
	if (!values) return undefined
	const kept = values.map(v => v.trim()).filter(v => v.length > 0)
	return kept.length === 0 ? undefined : kept
}

/**
 * What `participant` was asked for: one address, or a whole domain.
 *
 * A domain is written the way people write one, with the `@` in front, and it
 * matches that domain exactly — `@acme.com` is not `mail.acme.com` and not
 * `notacme.com`. Anything that would match far more than it looks like it
 * should is refused instead: `@` alone, `ana@` with nothing after it, a bare
 * domain with no `@`, or a name-and-address form.
 */
export type Participant =
	| { readonly kind: 'address'; readonly address: string }
	| { readonly kind: 'domain'; readonly domain: string }
	| { readonly kind: 'refused'; readonly why: string }

export const parseParticipant = (raw: string): Participant => {
	const value = raw.trim().toLowerCase()
	if (value.length === 0) {
		return { kind: 'refused', why: 'participant was empty' }
	}
	if (value.includes('<') || value.includes('>') || /\s/.test(value)) {
		return {
			kind: 'refused',
			why: 'participant takes an address on its own, like ana@acme.com, or a domain written as @acme.com',
		}
	}
	if (value.startsWith('@')) {
		const domain = value.slice(1)
		if (domain.length === 0 || domain.startsWith('.') || domain.endsWith('.')) {
			return { kind: 'refused', why: 'that is not a domain' }
		}
		return { kind: 'domain', domain }
	}
	const at = value.indexOf('@')
	if (at <= 0 || at === value.length - 1) {
		return {
			kind: 'refused',
			why: 'participant takes a whole address, or a domain written as @acme.com',
		}
	}
	return { kind: 'address', address: value }
}

/**
 * A date bound, as the filters accept it: a plain day, or a moment that says
 * which clock it is on.
 *
 * A moment with no timezone would be read against whichever clock the server
 * happens to keep, so it is refused rather than quietly meaning two different
 * instants on two machines. A day that does not exist is refused too: the
 * ordinary date reader turns 30 February into 2 March without a word.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/
const MOMENT =
	/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

export const parseDateBound = (
	raw: string,
): { readonly at: Date } | { readonly refused: string } => {
	const value = raw.trim()
	if (DAY.test(value)) {
		const at = new Date(`${value}T00:00:00Z`)
		if (Number.isNaN(at.getTime()) || !at.toISOString().startsWith(value)) {
			return { refused: `${raw} is not a date on the calendar` }
		}
		return { at }
	}
	if (MOMENT.test(value)) {
		const at = new Date(value)
		if (Number.isNaN(at.getTime())) {
			return { refused: `${raw} is not a date on the calendar` }
		}
		return { at }
	}
	return {
		refused: `${raw} is not a date I can read. Write a day as 2026-09-01, or a moment as 2026-09-01T09:00:00Z.`,
	}
}

/**
 * Both ends of a range, checked together. The earlier bound is included and
 * the later one is not, so asking for the same moment twice can only ever find
 * nothing — which reads as "you have none" when it means "that is not a range".
 */
export const checkDateRange = (args: {
	readonly after?: string | undefined
	readonly before?: string | undefined
	readonly names: readonly [string, string]
}): { readonly refused: string } | null => {
	const [afterName, beforeName] = args.names
	const after = args.after === undefined ? null : parseDateBound(args.after)
	if (after && 'refused' in after) return { refused: after.refused }
	const before = args.before === undefined ? null : parseDateBound(args.before)
	if (before && 'refused' in before) return { refused: before.refused }
	if (after && before && after.at.getTime() >= before.at.getTime()) {
		return {
			refused: `${afterName} has to be earlier than ${beforeName}; as given they can only find nothing.`,
		}
	}
	return null
}

/** Matches the address, or the whole domain, on any message in the thread. */
const participantCondition = (
	sql: SqlClient.SqlClient,
	participant: Participant,
): Statement.Fragment | null => {
	if (participant.kind === 'refused') return null
	if (participant.kind === 'address') {
		return sql`lower(mp.email_address) = ${participant.address}`
	}
	// Anchored on the `@`, so a domain never matches one that merely ends the
	// same way. The stored address is escaped as text, so a `%` somebody typed
	// is a percent sign rather than "anything".
	return sql`lower(mp.email_address) LIKE ${`%@${asPlainText(participant.domain)}`}`
}

/** At least one attachment somebody meant to send, rather than an inline image. */
const hasRealAttachment = (sql: SqlClient.SqlClient): Statement.Fragment =>
	sql`EXISTS (
		SELECT 1 FROM jsonb_array_elements(m.attachments) a
		WHERE COALESCE((a->>'isInline')::boolean, false) = false
	)`

export interface ThreadConditions {
	readonly conditions: ReadonlyArray<Statement.Fragment>
	/** Whether any condition reads a value worked out per conversation. */
	readonly needsThreadFacts: boolean
}

export const threadConditions = (
	sql: SqlClient.SqlClient,
	filters: ThreadFilters,
): ThreadConditions => {
	const conditions: Array<Statement.Fragment> = []
	let needsThreadFacts = false

	if (filters.inboxId) {
		conditions.push(sql`EXISTS (
			SELECT 1 FROM email_messages m
			WHERE ${inThread(sql)} AND m.inbox_id = ${filters.inboxId}
		)`)
	}
	if (filters.companyId) {
		conditions.push(sql`tl.company_id = ${filters.companyId}`)
	}
	if (filters.contactId) {
		conditions.push(sql`tl.contact_id = ${filters.contactId}`)
	}
	const statuses = asked(filters.status)
	if (statuses) {
		conditions.push(sql`tl.status IN ${sql.in(statuses)}`)
	}
	if (filters.waitingOn) {
		// Only a conversation still open is waiting for anybody: one that was
		// closed or put away has had its answer, or does not want one.
		needsThreadFacts = true
		conditions.push(sql`tl.status = 'open'`)
		conditions.push(
			filters.waitingOn === 'us'
				? // They wrote last. Mail a check marked as junk is not somebody
					// waiting on an answer.
					sql`latest.direction = 'inbound'
						AND (latest.inbound_classification IS NULL OR latest.inbound_classification = 'normal')`
				: // We wrote last, and it arrived: a message that bounced is
					// waiting on us to find a working address, not on them.
					sql`latest.direction = 'outbound' AND latest.status <> 'bounced'`,
		)
	}
	if (filters.unread !== undefined) {
		needsThreadFacts = true
		conditions.push(
			filters.unread
				? sql`stats.last_arrival_at > COALESCE(tl.last_read_at, 'epoch'::timestamptz)`
				: sql`COALESCE(stats.last_arrival_at <= COALESCE(tl.last_read_at, 'epoch'::timestamptz), true)`,
		)
	}
	if (filters.quietDays !== undefined) {
		needsThreadFacts = true
		conditions.push(
			sql`stats.last_message_at <= now() - (${filters.quietDays} * interval '1 day')`,
		)
	}
	if (filters.lastMessageAfter) {
		const bound = parseDateBound(filters.lastMessageAfter)
		if ('at' in bound) {
			needsThreadFacts = true
			conditions.push(sql`stats.last_message_at >= ${bound.at}`)
		}
	}
	if (filters.lastMessageBefore) {
		const bound = parseDateBound(filters.lastMessageBefore)
		if ('at' in bound) {
			needsThreadFacts = true
			conditions.push(sql`stats.last_message_at < ${bound.at}`)
		}
	}
	if (filters.participant) {
		const participant = parseParticipant(filters.participant)
		const match = participantCondition(sql, participant)
		if (match) {
			conditions.push(sql`EXISTS (
				SELECT 1 FROM email_messages m
				JOIN message_participants mp ON mp.email_message_id = m.id
				WHERE ${inThread(sql)} AND ${match}
			)`)
		}
	}
	if (filters.hasAttachments !== undefined) {
		const withOne = sql`EXISTS (
			SELECT 1 FROM email_messages m
			WHERE ${inThread(sql)} AND ${hasRealAttachment(sql)}
		)`
		conditions.push(filters.hasAttachments ? withOne : sql`NOT ${withOne}`)
	}
	const owners = asked(filters.companyOwner)
	if (owners) {
		// A conversation with no company is nobody's lead, so it matches no
		// owner — not even "nobody has taken this", which is about a company
		// that exists.
		conditions.push(sql`EXISTS (
			SELECT 1 FROM companies c
			WHERE c.id = tl.company_id AND ${ownerCondition(sql, sql`c.owner_id`, owners)}
		)`)
	}

	return { conditions, needsThreadFacts }
}

export const messageConditions = (
	sql: SqlClient.SqlClient,
	filters: MessageFilters,
): ReadonlyArray<Statement.Fragment> => {
	const conditions: Array<Statement.Fragment> = []
	if (filters.contactId) conditions.push(sql`contact_id = ${filters.contactId}`)
	if (filters.companyId) conditions.push(sql`company_id = ${filters.companyId}`)
	if (filters.inboxId) conditions.push(sql`inbox_id = ${filters.inboxId}`)
	const statuses = asked(filters.status)
	if (statuses) conditions.push(sql`status IN ${sql.in(statuses)}`)
	if (filters.direction) conditions.push(sql`direction = ${filters.direction}`)
	if (filters.bounceType) {
		conditions.push(sql`bounce_type = ${filters.bounceType}`)
	}
	if (filters.receivedAfter) {
		const bound = parseDateBound(filters.receivedAfter)
		if ('at' in bound) conditions.push(sql`received_at >= ${bound.at}`)
	}
	if (filters.receivedBefore) {
		const bound = parseDateBound(filters.receivedBefore)
		if ('at' in bound) conditions.push(sql`received_at < ${bound.at}`)
	}
	if (filters.participant) {
		const participant = parseParticipant(filters.participant)
		const match = participantCondition(sql, participant)
		if (match) {
			conditions.push(sql`EXISTS (
				SELECT 1 FROM message_participants mp
				WHERE mp.email_message_id = email_messages.id AND ${match}
			)`)
		}
	}
	if (filters.query) {
		const trimmed = filters.query.trim()
		if (trimmed.length > 0) {
			conditions.push(sql`(
				search_vector @@ plainto_tsquery('simple', ${trimmed})
				OR EXISTS (
					SELECT 1 FROM message_participants mp
					WHERE mp.email_message_id = email_messages.id
					  AND lower(mp.email_address) LIKE ${`%${asPlainText(trimmed.toLowerCase())}%`}
				)
			)`)
		}
	}
	return conditions
}

/**
 * The order the list is read in.
 *
 * The default is what happened last on the conversation, which is also what
 * moves it when somebody files it away. The id settles ties, so paging through
 * conversations touched in the same instant never repeats or skips one.
 *
 * Reading by latest message reaches for a value worked out per conversation,
 * which is why the caller asks for those alongside any filter that needs them.
 */
export const threadOrder = (
	sql: SqlClient.SqlClient,
	sort: ThreadSort | undefined,
): Statement.Fragment =>
	sort === 'latest_message'
		? sql`ORDER BY stats.last_message_at DESC NULLS LAST, tl.id DESC`
		: sql`ORDER BY tl.updated_at DESC, tl.id DESC`
