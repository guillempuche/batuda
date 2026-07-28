import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

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

// A company whose stored next-action date has slipped past now.
const NextStepCompany = Schema.Struct({
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
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

export const NextSteps = Schema.Struct({
	dueTasks: Schema.Array(NextStepTask),
	overdueCompanies: Schema.Array(NextStepCompany),
	researchAwaitingReview: Schema.Array(NextStepResearchRun),

	// One cap covers three separate lists, so "there is more" has to be said
	// three times: a reader told only that something was cut short cannot tell
	// which of the three it happened to.
	dueTasksTruncated: Schema.Boolean,
	overdueCompaniesTruncated: Schema.Boolean,
	researchAwaitingReviewTruncated: Schema.Boolean,
})

export const PipelineGroup = HttpApiGroup.make('pipeline')
	.add(
		HttpApiEndpoint.get('get', '/pipeline', {
			success: PipelineSnapshot,
		}),
	)
	.add(
		HttpApiEndpoint.get('nextSteps', '/pipeline/next-steps', {
			query: { limit: pageQuery.limit },
			success: NextSteps,
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')
