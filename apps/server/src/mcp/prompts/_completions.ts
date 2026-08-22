import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { textAtTheStart } from '../../lib/search-text'

export const completeCompanySlug = (input: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<{ slug: string }>`
				SELECT slug FROM companies
				WHERE slug ILIKE ${textAtTheStart(input)}
					AND deleted_at IS NULL
				ORDER BY updated_at DESC LIMIT 10
			`
		return rows.map(row => row.slug)
	})
