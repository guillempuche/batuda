import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// A company kept one mailbox, one telephone number, one website and one handle
// per social network, each in a column of its own. Now that a way of reaching
// somebody can belong to a company, those columns are the one place a second one
// cannot go — and while they exist there are two answers to "what is this
// company's email", which is worse than either.
//
// So they move. Every value on file becomes a channel on its company, marked as
// the primary one of its kind, and the columns go. Reading "the company's email"
// becomes "the primary email channel of this company", which is the same answer
// today and can be several tomorrow.
//
// `google_maps_url` deliberately stays a column. It is a link to a place on a
// map, not a way of reaching anybody, and it belongs with the coordinates beside
// it rather than with the mailboxes.
//
// expand-contract: pre-production clean break — this same release rewrites every
// reader and writer of the five columns (the domain model and the typed client
// built from it, the company page, the MCP create/update tools, the research
// write allowlist and the snapshot a run is shown, the inbound sender-domain
// fallback, and the seeds) onto channels. Nothing queries the dropped columns
// once this deploy is out. Values are carried over first, so no reachable
// address is lost.

const MOVED = [
	['email', 'email'],
	['phone', 'phone'],
	['website', 'website'],
	['linkedin', 'linkedin'],
	['instagram', 'instagram'],
] as const

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	// One statement per kind rather than one clever statement: each reads as the
	// sentence it is, and a column that turns out to be empty everywhere simply
	// moves nothing.
	for (const [column, channel] of MOVED) {
		yield* sql`
			INSERT INTO channels
				(organization_id, subject_table, subject_id, channel, address, is_primary)
			SELECT organization_id, 'companies', id, ${channel}, btrim(${sql(column)}), true
			FROM companies
			WHERE ${sql(column)} IS NOT NULL AND btrim(${sql(column)}) <> ''
			ON CONFLICT (subject_table, subject_id, channel, address) DO NOTHING
		`
	}

	for (const [column] of MOVED) {
		yield* sql`ALTER TABLE companies DROP COLUMN IF EXISTS ${sql(column)}`
	}
})
