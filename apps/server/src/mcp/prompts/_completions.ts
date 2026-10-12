import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { textAtTheStart } from '../../lib/search-text'
import { inMcpOrgScope } from '../org-scope'

export const completeCompanySlug = (input: string) =>
	inMcpOrgScope(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<{ slug: string }>`
				SELECT slug FROM companies
				WHERE slug ILIKE ${textAtTheStart(input)}
					AND deleted_at IS NULL
				ORDER BY updated_at DESC LIMIT 10
			`
			return rows.map(row => row.slug)
		}),
	)
