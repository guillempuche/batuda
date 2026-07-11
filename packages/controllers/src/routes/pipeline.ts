import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'

// Pipeline snapshot for the dashboard: a status → count histogram plus the two
// attention counters. All plain numbers, so the response encoder types it fine.
const PipelineSnapshot = Schema.Struct({
	statusCounts: Schema.Record(Schema.String, Schema.Number),
	overdueTaskCount: Schema.Number,
	companiesWithoutNextAction: Schema.Number,
})

export const PipelineGroup = HttpApiGroup.make('pipeline')
	.add(
		HttpApiEndpoint.get('get', '/pipeline', {
			success: PipelineSnapshot,
		}),
	)
	.add(
		HttpApiEndpoint.get('nextSteps', '/pipeline/next-steps', {
			query: {
				limit: Schema.optional(Schema.NumberFromString),
			},
			// The rows carry raw timestamps the response encoder can't type as
			// dates, so keep the payload opaque over the wire and let the client
			// narrow it (same approach as the companies list).
			success: Schema.Unknown,
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')
