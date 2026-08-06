import type { SqlClient, Statement } from 'effect/unstable/sql'

import type { AttentionFilter } from '@batuda/domain'

export type { AttentionFilter }

/**
 * What makes a company worth someone's attention today.
 *
 * Two screens ask this: the dashboard, which shows the urgent handful, and the
 * company list the dashboard links into when somebody wants all of them. They
 * have to agree — a heading that says 65 must open a list of 65 — so the rules
 * are written once here rather than once per screen.
 */

/**
 * How long a company still in play may go unheard from before it counts as
 * having gone quiet, when the caller does not say. Two weeks suits a trade where
 * a quote turns around in days; anyone selling on a longer cycle passes their
 * own number rather than living with this one.
 */
export const DEFAULT_STALE_DAYS = 14

/** Only the hottest companies lead the high-priority list unless asked otherwise. */
export const DEFAULT_PRIORITY_AT_LEAST = 1

/**
 * A company nobody is selling to any more belongs on none of these lists. Named
 * by what is excluded rather than what is included, so a status added later
 * lands on the lists by default instead of silently vanishing from them.
 */
export const TERMINAL_STATUSES = ['closed', 'dead'] as const

/** The stages where silence is worth flagging — before a deal, not after it. */
export const CHASING_STATUSES = [
	'contacted',
	'responded',
	'meeting',
	'proposal',
] as const

/**
 * Still being sold to: not deleted, and not at a stage where the answer is
 * already known. Every rule below starts from this, so a deleted company cannot
 * reappear through whichever one was written last.
 */
export const inPlay = (sql: SqlClient.SqlClient): Statement.Fragment => sql`
	deleted_at IS NULL
	AND status NOT IN ${sql.in(TERMINAL_STATUSES)}
`

/** The follow-up date somebody set has already passed. */
export const isOverdue = (sql: SqlClient.SqlClient): Statement.Fragment =>
	sql`next_action_at < now() AND ${inPlay(sql)}`

/**
 * Mid-chase and not heard from in a while — or ever.
 *
 * The last line is what keeps a company off this list once its follow-up date
 * has already passed: being chased late is the more urgent way of saying the
 * same thing, so overdue wins the company.
 *
 * Kept free of `--` comments on purpose: this fragment gets embedded inside
 * `NOT (…)` below, where a trailing SQL comment would swallow the bracket.
 */
export const isStale = (
	sql: SqlClient.SqlClient,
	staleDays: number = DEFAULT_STALE_DAYS,
): Statement.Fragment => sql`
	deleted_at IS NULL
	AND status IN ${sql.in(CHASING_STATUSES)}
	AND (
		last_contacted_at IS NULL
		OR last_contacted_at < now() - (${staleDays} * interval '1 day')
	)
	AND (next_action_at IS NULL OR next_action_at >= now())
`

/** Hot, nothing booked in, and not already answered for by the two above. */
export const isHighPriority = (
	sql: SqlClient.SqlClient,
	options: {
		readonly staleDays?: number | undefined
		readonly priorityAtLeast?: number | undefined
	} = {},
): Statement.Fragment => sql`
	priority <= ${options.priorityAtLeast ?? DEFAULT_PRIORITY_AT_LEAST}
	AND next_action_at IS NULL
	AND ${inPlay(sql)}
	AND NOT (${isStale(sql, options.staleDays)})
`

/**
 * Nothing written down about what happens next.
 *
 * Signed clients are left out, unlike the lists above: a client with no next
 * step is ordinary, a prospect with none is a lead going nowhere. This reads the
 * written note rather than the date, and roughly half of any real company list
 * has one without the other — so the two are not interchangeable, and the
 * dashboard counter and the page it opens both have to use this one.
 */
export const hasNoNextAction = (
	sql: SqlClient.SqlClient,
): Statement.Fragment => sql`
	next_action IS NULL
	AND deleted_at IS NULL
	AND status NOT IN ${sql.in([...TERMINAL_STATUSES, 'client'])}
`

/**
 * Turn the caller's word into the rule it names. The words themselves live in
 * the domain, so the screen, the contract and this module cannot disagree about
 * which ones exist.
 */
export const attentionCondition = (
	sql: SqlClient.SqlClient,
	attention: AttentionFilter,
	staleDays?: number | undefined,
): Statement.Fragment => {
	switch (attention) {
		case 'overdue':
			return isOverdue(sql)
		case 'stale':
			return isStale(sql, staleDays)
		case 'no-next-action':
			return hasNoNextAction(sql)
	}
}
