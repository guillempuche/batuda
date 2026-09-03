import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Three things a company list needs before its filters can be trusted.
//
// First, one spelling per country. The shape a country has to have — two
// letters — never said which case, and it is written in as free text, so `es`
// was as storable as `ES`. Both the filter and the per-value counts compare the
// stored text exactly, so a company saved lowercase was missed by anyone asking
// for the capitals, and was offered as a second Spain with a count of its own.
// Only rows that are actually a two-letter code are touched: a hand-typed
// `Spain` is left alone rather than shouted back as `SPAIN`, since raising it
// cannot be undone and would not make it findable either.
//
// Second, tags that can survive a round trip. Several tags travel to and from a
// screen as one comma-separated value, so a tag holding a comma comes back as
// two tags nobody carries: the menu offers it, and picking it finds nothing.
// New ones are turned away where they are written; these are the ones already
// stored, split on the comma into the tags they were plainly meant to be, with
// blank ends trimmed and any duplicate the split creates dropped. Irreversible,
// and deliberately so — the single tag it came from could never be asked for.
//
// Third, an index for tags. Narrowing by a tag is `tags @> …`, which a GIN index
// serves. Offering the tags worth narrowing by expands every company's array,
// which no index can serve — that one stays a scan.
//
// All three change nothing on a second run.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		UPDATE companies
		SET country = upper(country)
		WHERE country IS NOT NULL
			AND country ~ '^[A-Za-z]{2}$'
			AND country <> upper(country)
	`

	yield* sql`
		UPDATE companies
		SET tags = cleaned.tags
		FROM (
			SELECT c.id,
				array_agg(DISTINCT btrim(part)) FILTER (WHERE btrim(part) <> '') AS tags
			FROM companies c, unnest(c.tags) AS tag, unnest(string_to_array(tag, ',')) AS part
			WHERE c.tags IS NOT NULL
			GROUP BY c.id
		) AS cleaned
		WHERE companies.id = cleaned.id
			AND companies.tags IS DISTINCT FROM cleaned.tags
	`

	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_companies_tags
			ON companies USING GIN (tags)
	`
})
