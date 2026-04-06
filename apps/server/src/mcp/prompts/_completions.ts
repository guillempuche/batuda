import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

export const completeCompanySlug = (input: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows =
			yield* sql`SELECT slug FROM companies WHERE slug ILIKE ${input + '%'} ORDER BY updated_at DESC LIMIT 10`
		return rows.map((r: any) => r.slug as string)
	})
