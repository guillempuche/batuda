import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

export const completeCompanySlug = (input: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<{ slug: string }>`
				SELECT slug FROM companies
				WHERE slug ILIKE ${`${input}%`}
					AND deleted_at IS NULL
				ORDER BY updated_at DESC LIMIT 10
			`
		return rows.map(row => row.slug)
	})
