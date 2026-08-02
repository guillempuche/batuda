// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { foldLabel } from '@batuda/domain'

// The one place the folding rule is written twice.
//
// Deciding when two spellings mean the same trade belongs in TypeScript, and it
// lives there — except in migration 0056, which had to fold a whole existing
// table and could not stream it through the application to do so. That leaves one
// SQL copy of the rule, and a copy nobody compares is a copy that drifts: the
// migration would file trades under keys the application then fails to find,
// silently creating a second row for a trade that is already there.
//
// So this runs both over the awkward cases and insists they agree. If it ever
// fails, the migration's expression is the one that must follow TypeScript.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL = process.env['DATABASE_URL'] as string

// The migration's expression, verbatim.
const SQL_FOLD = `btrim(regexp_replace(lower(regexp_replace(normalize($1, NFD), '[̀-ͯ·]', '', 'g')), '[^[:alnum:]]+', ' ', 'g'))`

const AWKWARD = [
	'Metal fabrication',
	'metal Fabrication',
	'  METAL   FABRICATION  ',
	'Metal-fabricació',
	'Import / Export, S.L.',
	'Ferré & Fills',
	// The Catalan geminate l·l. The middle dot carries Unicode's Diacritic
	// property, so the application strips it and reads "metal·lúrgia" as one word
	// — which is right, it is one letter, not a word break. An earlier version of
	// the migration turned it into a space instead, and every Catalan trade
	// carrying it was filed under a key the application would never look up.
	'Metal·lúrgia',
	'Instal·lacions elèctriques',
	'Col·legi',
	// The apostrophe a word processor types, and the one a keyboard types. Both
	// are ordinary in a Catalan or French trade name, and neither is a letter,
	// so both have to come out as a word break on both sides.
	'Disseny d’interiors',
	"Fusteria d'alumini",
	// Not Latin at all — a narrower rule empties these, and under a uniqueness
	// rule every one of them would become the same trade.
	'物流',
	'Логистика',
	'Μεταφορές',
	'حدادة',
	// Single letters rather than a letter with a mark added, so stripping marks
	// never reaches them.
	'Tømrer',
	'Straßenbau',
	'Stolarstwo łukowe',
	'Građevinarstvo',
	// Nothing to fold at all.
	'...',
	'   ',
]

let pool: pg.Pool

beforeAll(() => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })
})

afterAll(async () => {
	await pool.end()
})

describe('the folding that decides two spellings are one trade', () => {
	describe('when the database folds a name and the application folds the same name', () => {
		it('should reach the same answer', async () => {
			for (const written of AWKWARD) {
				// WHEN the migration's expression runs over it
				const result = await pool.query<{ folded: string }>(
					`SELECT ${SQL_FOLD} AS folded`,
					[written],
				)
				// THEN it agrees with the rule the application uses
				expect(result.rows[0]?.folded, written).toBe(foldLabel(written))
			}
		})
	})

	describe('when a name is written in a script with no Latin letters', () => {
		it('should keep something to file it under, in both', async () => {
			for (const written of ['物流', 'Логистика', 'حدادة']) {
				const result = await pool.query<{ folded: string }>(
					`SELECT ${SQL_FOLD} AS folded`,
					[written],
				)
				expect(result.rows[0]?.folded, written).not.toBe('')
				expect(foldLabel(written), written).not.toBe('')
			}
		})
	})
})
