import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

import { COMPANY_PRIORITIES } from '@batuda/domain'

import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'
import { pageQuery } from '../pagination'

// Pipeline snapshot for the dashboard: a status → count histogram plus the two
// attention counters. All plain numbers, so the response encoder types it fine.
export const PipelineSnapshot = Schema.Struct({
	statusCounts: Schema.Record(Schema.String, Schema.Number),
	overdueTaskCount: Schema.Number,
	companiesWithoutNextAction: Schema.Number,
})

// A task on the daily-planning list, joined with its company for display.
const NextStepTask = Schema.Struct({
	id: Schema.String,
	title: Schema.String,
	type: Schema.String,
	dueAt: Schema.NullOr(Schema.DateTimeUtcFromString),
	companyId: Schema.String,
	companyName: Schema.String,
	companySlug: Schema.String,
})

// A company on one of the attention lists. It carries everything a company card
// shows, not just the dates that put it on the list — the screen draws the same
// card here as it does anywhere else, and a name and a date alone would leave it
// without its status, its trade or its priority.
const NextStepCompany = Schema.Struct({
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
	status: Schema.String,
	industry: Schema.NullOr(Schema.String),
	location: Schema.NullOr(Schema.String),
	country: Schema.NullOr(Schema.String),
	priority: Schema.NullOr(Schema.Number),
	lastContactedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
	nextAction: Schema.NullOr(Schema.String),
	nextActionAt: Schema.NullOr(Schema.DateTimeUtcFromString),
})

// A finished research run still waiting on a person: it has changes it wants to
// make to the CRM, or it ended in a state that asks to be looked at. The company
// is optional because a freeform or scan run is tied to no single one.
const NextStepResearchRun = Schema.Struct({
	id: Schema.String,
	query: Schema.String,
	status: Schema.String,
	completedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
	pendingUpdateCount: Schema.Number,
	companyId: Schema.NullOr(Schema.String),
	companyName: Schema.NullOr(Schema.String),
	companySlug: Schema.NullOr(Schema.String),
})

// How many rows each list would hold if nothing had been cut. A screen showing
// the urgent handful still has to say how many there are altogether, and the
// "there is more" flags below can only say that something was left out, not how
// much. One entry per list, so no list answers the question differently.
const NextStepCounts = Schema.Struct({
	dueTasks: Schema.Number,
	overdueCompanies: Schema.Number,
	staleCompanies: Schema.Number,
	highPriority: Schema.Number,
	researchAwaitingReview: Schema.Number,
})

export const NextSteps = Schema.Struct({
	dueTasks: Schema.Array(NextStepTask),
	// A company belongs to at most one of these three. Someone who has slipped
	// past their follow-up date is not also listed as having gone quiet, and the
	// three lists read as one queue rather than as the same company three times.
	overdueCompanies: Schema.Array(NextStepCompany),
	staleCompanies: Schema.Array(NextStepCompany),
	highPriority: Schema.Array(NextStepCompany),
	researchAwaitingReview: Schema.Array(NextStepResearchRun),

	counts: NextStepCounts,

	// One cap covers every list, so "there is more" has to be said once per list:
	// a reader told only that something was cut short cannot tell which.
	dueTasksTruncated: Schema.Boolean,
	overdueCompaniesTruncated: Schema.Boolean,
	staleCompaniesTruncated: Schema.Boolean,
	highPriorityTruncated: Schema.Boolean,
	researchAwaitingReviewTruncated: Schema.Boolean,
})

/**
 * How long a company in play may go unheard from before it counts as having gone
 * quiet. Whoever is asking decides: a workshop chasing local trade and a firm
 * selling machinery on six-month cycles do not mean the same thing by "quiet",
 * and a number buried in a query would make that a deploy rather than a request.
 *
 * A decade is the ceiling — past that the answer is every company that was ever
 * spoken to, which no list is asking for.
 */
export const STALE_DAYS_BOUNDS = { minimum: 1, maximum: 3650 } as const

/**
 * How far down the priority scale the high-priority list reaches, read as
 * importance rather than as the stored number — 1 is the hottest, so `2` takes
 * priorities 1 and 2. The ceiling follows the scale the domain defines, so
 * widening that scale does not quietly leave this behind.
 */
export const PRIORITY_AT_LEAST_BOUNDS = {
	minimum: Math.min(...COMPANY_PRIORITIES),
	maximum: Math.max(...COMPANY_PRIORITIES),
} as const

const StaleDays = Schema.FiniteFromString.pipe(
	Schema.check(Schema.isInt(), Schema.isBetween(STALE_DAYS_BOUNDS)),
)

const PriorityAtLeast = Schema.FiniteFromString.pipe(
	Schema.check(Schema.isInt(), Schema.isBetween(PRIORITY_AT_LEAST_BOUNDS)),
)

export const PipelineGroup = HttpApiGroup.make('pipeline')
	.add(
		HttpApiEndpoint.get('get', '/pipeline', {
			success: PipelineSnapshot,
		}),
	)
	.add(
		HttpApiEndpoint.get('nextSteps', '/pipeline/next-steps', {
			query: {
				limit: pageQuery.limit,
				staleDays: Schema.optional(StaleDays),
				priorityAtLeast: Schema.optional(PriorityAtLeast),
			},
			success: NextSteps,
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')
