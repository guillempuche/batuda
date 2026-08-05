import { Effect } from 'effect'
import type { SqlClient, Statement } from 'effect/unstable/sql'

/** Whether the caller asked to be told how many rows match in total. */
export type CountMode = 'exact' | 'none'

/**
 * What one page of a list was asked for: how many rows, from where, and
 * whether to count.
 */
export interface PageRequest {
	readonly limit: number
	readonly offset: number
	readonly count: CountMode
}

/**
 * The extra column that carries the total, or nothing at all. Counting rides
 * along with the page, which makes the database look at every matching row
 * even though only one page comes back — so when nobody will read the count,
 * that work never happens. Spread into the SELECT list, after the columns:
 * `SELECT *${totalColumn(…)}`.
 */
export function totalColumn(
	sql: SqlClient.SqlClient,
	count: CountMode,
): Statement.Fragment {
	return count === 'exact' ? sql`, COUNT(*) OVER () AS total` : sql``
}

/**
 * Ask for one row more than the page holds: that spare row is how a list knows
 * whether anything follows it without counting the whole table.
 * {@link takePage} drops it again before anyone sees it.
 */
export function probeLimit(limit: number): number {
	return limit + 1
}

/**
 * Trim the spare row off and say whether it was there. Must run before the rows
 * are decoded, or the caller is handed one row more than it asked for and
 * nothing catches it.
 */
export function takePage<R>(
	rows: ReadonlyArray<R>,
	limit: number,
): { readonly rows: ReadonlyArray<R>; readonly hasMore: boolean } {
	return { rows: rows.slice(0, limit), hasMore: rows.length > limit }
}

/**
 * Reads how many rows match in total from a page of results — the count rides
 * along on every row as a `COUNT(*) OVER ()` column, so any one row carries it.
 * Reports `0` when no row carries one, which is only truthful for a page that
 * starts at the beginning and was asked to be counted.
 *
 * Exported for lists that only ever start at the beginning — a capped list with
 * no offset to page through — where {@link resolveTotal}'s fallback query could
 * never run and asking for one would be dead code.
 */
export function readWindowTotal(
	rows: ReadonlyArray<{ readonly total?: string | number }>,
): number {
	const first = rows[0]
	return first?.total === undefined ? 0 : Number(first.total)
}

/**
 * How many rows match in total, or null when the caller asked not to be told.
 * An empty page that starts partway in says nothing about the total — the
 * filters may match nothing, or the page may simply start past the last match
 * — so `countMatching` is asked only in that one case to tell those apart.
 */
export function resolveTotal<E, R>(
	page: PageRequest,
	rows: ReadonlyArray<{ readonly total?: string | number }>,
	countMatching: () => Effect.Effect<
		ReadonlyArray<{ readonly count: string | number }>,
		E,
		R
	>,
): Effect.Effect<number | null, E, R> {
	if (page.count === 'none') return Effect.succeed(null)
	if (rows.length > 0 || page.offset === 0) {
		return Effect.succeed(readWindowTotal(rows))
	}
	return countMatching().pipe(
		Effect.map(countRows => Number(countRows[0]?.count ?? 0)),
	)
}

/**
 * Fill in what a caller left out. The ceiling is enforced by the request
 * schema, which refuses anything larger rather than quietly shrinking it, so
 * this only supplies each list's own defaults.
 */
export function pageOf(
	query: {
		readonly limit?: number | undefined
		readonly offset?: number | undefined
		readonly count?: CountMode | undefined
	},
	defaultLimit: number,
): PageRequest {
	return {
		limit: query.limit ?? defaultLimit,
		offset: query.offset ?? 0,
		count: query.count ?? 'none',
	}
}
