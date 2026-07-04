import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Bounding-box search filters companies by a latitude/longitude rectangle. A
// composite index over the two coordinate columns lets that range scan run
// without reading the whole table, and the partial predicate keeps the rows
// that were never geocoded (most of the table early on) out of the index.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_companies_lat_lng
			ON companies (latitude, longitude)
			WHERE latitude IS NOT NULL AND longitude IS NOT NULL
	`
})
