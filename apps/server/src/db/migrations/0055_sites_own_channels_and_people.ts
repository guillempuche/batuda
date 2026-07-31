import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// A branch is somewhere you can reach and somewhere people work, so it holds
// its own addresses and its own staff. Otherwise a chain with three shops keeps
// one pile of addresses and one pile of names, with nothing saying which shop
// any of them belong to.
//
// The site on a person is optional and sits beside `company_id` rather than
// replacing it: most companies have a single place, and somebody who moves
// between branches belongs to the company rather than to any one of them. When
// a branch closes they should stay with the company, which is why this is
// ON DELETE SET NULL rather than a cascade.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	// expand-contract: the wider rule accepts everything the narrower one did plus
	// one more answer, so an instance still serving through the deploy cannot
	// write anything it rejects. Widening has to drop and re-state the check —
	// there is no way to add to one that already exists.
	yield* sql`
		ALTER TABLE channels
			DROP CONSTRAINT IF EXISTS channels_subject_table_check
	`
	yield* sql`
		ALTER TABLE channels
			ADD CONSTRAINT channels_subject_table_check
			CHECK (subject_table IN ('companies', 'contacts', 'sites'))
	`

	yield* sql`
		ALTER TABLE contacts
			ADD COLUMN IF NOT EXISTS site_id UUID
				REFERENCES sites(id) ON DELETE SET NULL
	`
	// "Who works at this branch" is the question this answers, so it is the one
	// worth an index. Partial, because most people name no site at all.
	yield* sql`
		CREATE INDEX IF NOT EXISTS contacts_site_idx ON contacts(site_id)
			WHERE site_id IS NOT NULL
	`
})
