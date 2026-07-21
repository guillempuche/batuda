import { Effect } from 'effect'

import { SEED_REFERENCE, type SeedCtx } from './shared'

/** Wrap an identifier in double quotes, escaping any quote inside it. */
const quoteIdentifier = (name: string): string =>
	`"${name.replace(/"/g, '""')}"`

/**
 * Replaces the timestamps the database filled in by itself with the pinned
 * reference time.
 *
 * Columns like `created_at` default to the database clock, so every seed run
 * would otherwise stamp a different time and nothing that compares dates — a
 * test assertion, a screenshot — could be trusted.
 *
 * Only values the database defaulted are touched. The whole seed runs in one
 * transaction, so every defaulted column holds that transaction's start time;
 * matching on exactly that value leaves any date the seed stated outright —
 * when a meeting starts, when an email arrived — untouched.
 *
 * Doing this as a sweep rather than setting the columns on every insert also
 * avoids a trap in `normalizeRows`: a key present on only some rows in a batch
 * is written as an explicit NULL for the rest, which bypasses the column
 * default and fails the NOT NULL constraint.
 */
export const pinTimestamps = (
	{ sql }: SeedCtx,
	/** Restrict the sweep to these tables; omit to cover the whole schema. */
	onlyTables?: ReadonlyArray<string>,
) =>
	Effect.gen(function* () {
		// The Postgres client camel-cases every result key, including on raw
		// queries like these, so `column_name` arrives as `columnName`.
		const columns = yield* sql<{
			tableName: string
			columnName: string
		}>`
			SELECT c.table_name, c.column_name
			FROM information_schema.columns c
			JOIN information_schema.tables t
				ON t.table_schema = c.table_schema AND t.table_name = c.table_name
			WHERE c.table_schema = 'public'
				AND t.table_type = 'BASE TABLE'
				AND c.column_default LIKE '%now()%'
			ORDER BY c.table_name, c.column_name
		`

		let pinned = 0
		for (const { tableName, columnName } of columns) {
			if (onlyTables !== undefined && !onlyTables.includes(tableName)) {
				continue
			}
			// Compared against `now()` inside the query rather than a value read
			// back into JavaScript: the whole seed is one transaction, so `now()`
			// is the same instant throughout, and no round-trip can lose the
			// precision the match depends on.
			// Identifiers are double-quoted because Postgres folds a bare one to
			// lower case, which would miss the camel-cased tables in this schema.
			const table = quoteIdentifier(tableName)
			const column = quoteIdentifier(columnName)
			yield* sql`
				UPDATE ${sql.literal(table)}
				SET ${sql.literal(column)} = ${SEED_REFERENCE}
				WHERE ${sql.literal(column)} = now()
			`
			pinned++
		}
		yield* Effect.logInfo(
			`Pinned ${pinned} defaulted timestamp columns to ${SEED_REFERENCE.toISOString()}`,
		)
	})
