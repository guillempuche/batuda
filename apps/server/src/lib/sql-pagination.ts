import { Effect } from 'effect'

/**
 * Reads how many rows match in total from a page of results — the count
 * rides along on every row as a `COUNT(*) OVER ()` column, so any one row
 * carries it. An empty page has no row to read and so reports `0`, which is
 * only truthful for a page starting at the beginning: a page further in can
 * come back empty just because it starts past the last match.
 */
export function readWindowTotal(
	rows: ReadonlyArray<{ readonly total: string | number }>,
): number {
	const first = rows[0]
	return first === undefined ? 0 : Number(first.total)
}

/**
 * How many rows match in total, for a page that carries its own
 * `COUNT(*) OVER ()` column. An empty page that starts partway in says
 * nothing about the total — the filters may match nothing, or the page may
 * simply start past the last match — so `countMatching` is asked only in
 * that one case to tell those two apart.
 */
export function resolvePageTotal<E, R>(
	rows: ReadonlyArray<{ readonly total: string | number }>,
	offset: number,
	countMatching: () => Effect.Effect<
		ReadonlyArray<{ readonly count: string | number }>,
		E,
		R
	>,
): Effect.Effect<number, E, R> {
	if (rows.length > 0 || offset === 0) {
		return Effect.succeed(readWindowTotal(rows))
	}
	return countMatching().pipe(
		Effect.map(countRows => Number(countRows[0]?.count ?? 0)),
	)
}
