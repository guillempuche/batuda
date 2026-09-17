import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Let a page be found by its address.
//
// A run's citations name a page two ways: by the id the run stamped on it, or
// by the address itself, which is how a model cites a page it read and how a
// citation is put back to the page it names. The provenance a company or a
// contact shows joins those citations to the stored pages by either, and
// without an index the half by address reads every stored page for every
// citation, on every profile somebody opens.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_sources_url ON sources (url)
	`
})
