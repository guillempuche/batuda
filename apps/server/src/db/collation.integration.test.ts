import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

// What the locale a database was built with decides, and why a wrong one is
// refused before anything is written.
//
// Postgres reads `[[:alnum:]]` — "is this a letter or a digit" — according to the
// locale the database was created with. Under `C` that means a-z and nothing else,
// so a trade written in Chinese or Cyrillic folds to nothing, and a migration that
// drops rows folding to nothing drops those companies' trades with no error raised
// anywhere. The locale cannot be changed afterwards, so the only remedy is to
// refuse the database, which is what `migrate.ts` does with this same question.
//
// A real Postgres either way: what is being pinned is the database's behaviour, not
// a regular expression's.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const A_WORD_IN_EVERY_ALPHABET = '北京 Логистика Μεταφορές निर्माण'

const BASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

const PROBE_DB = 'batuda_it_collation_probe'

const urlFor = (database: string): string => {
	const url = new URL(BASE_URL)
	url.pathname = `/${database}`
	return url.toString()
}

// The reading `migrate.ts` makes, asked of one database.
const lettersSurviving = async (url: string): Promise<string> => {
	const client = new pg.Client({ connectionString: url })
	await client.connect()
	try {
		const { rows } = await client.query<{ readable: string }>(
			`SELECT regexp_replace($1, '[^[:alnum:]]+', '', 'g') AS readable`,
			[A_WORD_IN_EVERY_ALPHABET],
		)
		return rows[0]?.readable ?? ''
	} finally {
		await client.end()
	}
}

const onPostgres = async (statement: string): Promise<void> => {
	const client = new pg.Client({ connectionString: urlFor('postgres') })
	await client.connect()
	try {
		await client.query(statement)
	} finally {
		await client.end()
	}
}

afterAll(async () => {
	await onPostgres(`DROP DATABASE IF EXISTS ${PROBE_DB}`)
})

describe('the locale a database is built with', () => {
	describe('when the database reads every alphabet', () => {
		it('should keep the letters of a name written in any of them', async () => {
			// GIVEN the integration database, built with an explicit UTF-8 locale
			// WHEN Postgres is asked which characters of a four-alphabet phrase are
			// letters
			const readable = await lettersSurviving(BASE_URL)

			// THEN it keeps them. Migrations that fold a name in SQL depend on this,
			// and until now nothing in the schema stated the assumption
			expect(readable).not.toBe('')
			expect(readable).toContain('北京')
			expect(readable).toContain('Логистика')
			expect(readable).toContain('Μεταφορές')
		})
	})

	describe('when a database is built with the C locale instead', () => {
		it('should read none of those letters, which is what the check refuses', async () => {
			// GIVEN a database created with the `C` locale, as a bare CREATE DATABASE
			// on a differently-built server can produce
			await onPostgres(`DROP DATABASE IF EXISTS ${PROBE_DB}`)
			await onPostgres(
				`CREATE DATABASE ${PROBE_DB} LOCALE 'C' TEMPLATE template0`,
			)

			// WHEN the same question is asked of it
			const readable = await lettersSurviving(urlFor(PROBE_DB))

			// THEN every letter is gone. A migration folding a name here writes an
			// empty key, and a row with an empty key is dropped — so the companies
			// silently never get their trade, which is why such a database is refused
			// outright rather than worked around
			expect(readable).toBe('')
		})
	})
})
