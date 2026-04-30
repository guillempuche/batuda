import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'

export const TimelineGroup = HttpApiGroup.make('timeline')
	.add(
		HttpApiEndpoint.get('list', '/timeline', {
			query: {
				companyId: Schema.optional(Schema.String),
				contactId: Schema.optional(Schema.String),
				channel: Schema.optional(Schema.String),
				kind: Schema.optional(Schema.String),
				since: Schema.optional(Schema.String),
				limit: Schema.optional(Schema.NumberFromString),
			},
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')
