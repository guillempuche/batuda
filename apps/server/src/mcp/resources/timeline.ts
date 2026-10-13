import { Effect, Schema } from 'effect'
import { McpSchema, McpServer } from 'effect/ai'
import { SqlClient } from 'effect/sql'

import { isUuidRef } from '@batuda/instructions'

import { companyVisible } from '../../services/company-liveness'
import { inMcpOrgScope } from '../org-scope'
import { noSuggestions } from '../prompts/_completions'

const companyIdParam = McpSchema.param('companyId', Schema.String)

export const TimelineResource =
	McpServer.resource`batuda://timeline/${companyIdParam}`({
		name: 'Company Timeline',
		description:
			'Chronological activity for a company: emails, calls, meetings, documents, proposals, research runs. Latest 100 events.',
		mimeType: 'application/json',
		audience: ['assistant'],
		completion: { companyId: noSuggestions },
		content: Effect.fn(function* (_uri, companyId) {
			// Something that is not an id names no company, so there is nothing to
			// list — and the database would refuse it outright.
			if (!isUuidRef(companyId)) return '[]'
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql`
				SELECT * FROM timeline_activity
				WHERE company_id = ${companyId}
					AND ${companyVisible(sql, sql`company_id`)}
				ORDER BY occurred_at DESC
				LIMIT 100
			`
			return JSON.stringify(rows, null, 2)
		}, inMcpOrgScope),
	})
