import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

import { TimelineActivity, TimelineEntityType } from '@batuda/domain'

import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'
import { PaginatedList } from '../pagination'

export const TimelineGroup = HttpApiGroup.make('timeline')
	.add(
		HttpApiEndpoint.get('list', '/timeline', {
			query: {
				companyId: Schema.optional(Schema.String),
				contactId: Schema.optional(Schema.String),
				// The thing an entry is about — a task, a proposal, a meeting.
				// Pass both to read one record's own history.
				entityType: Schema.optional(TimelineEntityType),
				entityId: Schema.optional(Schema.String),
				channel: Schema.optional(Schema.String),
				kind: Schema.optional(Schema.String),
				since: Schema.optional(Schema.String),
				limit: Schema.optional(Schema.NumberFromString),
				offset: Schema.optional(Schema.NumberFromString),
			},
			success: PaginatedList(TimelineActivity.json),
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')
