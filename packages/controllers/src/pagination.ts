import { Schema } from 'effect'

/**
 * Wire envelope for a paginated list endpoint: one page of items, how many
 * rows match in total (not just the ones on this page), and the
 * `limit`/`offset` that produced the page.
 */
export const PaginatedList = <S extends Schema.Top>(item: S) =>
	Schema.Struct({
		items: Schema.Array(item),
		total: Schema.Number,
		limit: Schema.Number,
		offset: Schema.Number,
	})
