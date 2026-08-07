import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Let a deleted company give its name back.
//
// A company's slug is unique within an organisation, and until now that held
// across deleted rows too — so deleting a company kept its name reserved for
// good. Adding the same firm again, under the name everybody calls it, failed
// with a duplicate-key error that said nothing about a company nobody can see.
//
// Narrowing the index to live rows is what makes deleting reversible in the way
// people expect: the name is free again, and re-adding a company you dropped
// last month behaves like adding any other.
//
// expand-contract: pre-production clean break. The same release teaches the
// duplicate check to look only at live companies, which is the other half of
// this — with the old index, skipping deleted rows would have reported a company
// created and then failed on the constraint.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE UNIQUE INDEX IF NOT EXISTS companies_organization_id_slug_live_key
			ON companies (organization_id, slug)
			WHERE deleted_at IS NULL
	`

	yield* sql`
		ALTER TABLE companies
			DROP CONSTRAINT IF EXISTS companies_organization_id_slug_key
	`

	// The constraint owns its index, so dropping it takes the index with it. A
	// database where the index was created without a constraint behind it needs
	// the second line instead.
	yield* sql`DROP INDEX IF EXISTS companies_organization_id_slug_key`
})
