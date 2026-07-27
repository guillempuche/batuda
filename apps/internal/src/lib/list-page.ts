/**
 * Which slice of a list to ask for: how many rows, from where, and whether to
 * be told the running total.
 *
 * The three travel together because they decide each other, and because they
 * have to appear identically in three places — the request itself, the key a
 * cached answer is filed under, and the key a server-rendered page hands to
 * the browser. A difference between any two of those goes unnoticed until a
 * screen quietly fetches everything twice.
 */
export type ListPage = {
	readonly limit: number
	readonly offset: number
	readonly count: 'exact' | 'none'
}

/**
 * The first slice. Ask to be counted only where a screen states a number —
 * counting means looking at every matching row, which is far more work than
 * fetching the handful being shown.
 */
export function firstPage(
	pageSize: number,
	count: ListPage['count'] = 'none',
): ListPage {
	return { limit: pageSize, offset: 0, count }
}

/**
 * The slice after this one, given how many rows actually came back.
 *
 * Advancing by rows *received* rather than rows *asked for* is what makes a
 * short answer harmless. If the server ever returns fewer than requested,
 * stepping on by the number requested would skip the difference silently —
 * rows nobody ever sees, with nothing to indicate they were missed.
 *
 * Later slices are never counted: the total does not change as the reader
 * moves through the list, so it is asked for once and held.
 */
export function advance(page: ListPage, rowsReceived: number): ListPage {
	return {
		limit: page.limit,
		offset: page.offset + rowsReceived,
		count: 'none',
	}
}

/** The part of a cache key that says which slice this is. */
export function listPageKey(page: ListPage): string {
	return `${page.limit}:${page.offset}:${page.count}`
}

/** The slice as an endpoint expects it, ready to spread into a query. */
export function listPageQuery(page: ListPage): {
	readonly limit: number
	readonly offset: number
	readonly count: 'exact' | 'none'
} {
	return { limit: page.limit, offset: page.offset, count: page.count }
}
