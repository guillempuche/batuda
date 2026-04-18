import { Effect, Schema } from 'effect'
import { McpSchema, McpServer } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

const companyIdParam = McpSchema.param('companyId', Schema.String)

export const TimelineResource =
	McpServer.resource`forja://timeline/${companyIdParam}`({
		name: 'Company Timeline',
		description:
			'Chronological activity for a company: emails, calls, meetings, documents, proposals, research runs. Latest 100 events.',
		mimeType: 'application/json',
		audience: ['assistant'],
		content: Effect.fn(function* (_uri, companyId) {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql`
				SELECT * FROM timeline_activity
				WHERE company_id = ${companyId}
				ORDER BY occurred_at DESC
				LIMIT 100
			`
			return JSON.stringify(rows, null, 2)
		}),
	})
