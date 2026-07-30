import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// The number a company is registered under — a Spanish NIF/CIF, a UK company
// number, a VAT number.
//
// It is the one name for a company that is unique the world over and does not
// change. Two firms can share a trading name, move house, rebrand, or run three
// websites; neither shares its registration number. Until now there was nowhere
// on the row to put one, so every run that found it threw it away: the prospect
// scan reads it off a page for free, and a Spanish register lookup buys it for
// about €0.29 — and the next lookup for the same company bought it again.
//
// Kept as free text rather than a checked format. Each country writes these
// differently, a person typing one in should not be refused because their
// country's shape is not yet known here, and the research guards are the place
// where a value's truth is judged.
//
// Indexed per organization so telling a company apart from a near-duplicate by
// its number is a lookup rather than a scan. Partial, so the rows that hold no
// number cost nothing.
//
// The index is on the number with its punctuation removed and its letters raised,
// because that is how two of them get compared: the same Spanish company is
// written "B12345678", "B-12345678" and "ESB12345678" on three different pages,
// and comparing those as they were typed would call one company three.
//
// Not unique. The same number really can arrive twice — two branches filed under
// one legal entity, or a duplicate somebody is still in the middle of merging —
// and refusing the write outright would lose the row instead of letting a person
// sort it out. Telling the caller "this one already exists" is the job, and that
// is done by looking first.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE companies
			ADD COLUMN IF NOT EXISTS tax_id text
	`

	yield* sql`
		CREATE INDEX IF NOT EXISTS companies_org_tax_id_idx
			ON companies (
				organization_id,
				upper(regexp_replace(tax_id, '[^A-Za-z0-9]', '', 'g'))
			)
			WHERE tax_id IS NOT NULL
	`
})
