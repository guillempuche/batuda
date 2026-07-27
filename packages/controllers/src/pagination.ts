import { Schema } from 'effect'

/**
 * The most rows one request may ask for, so no single caller can pull a whole
 * table. Sized for the largest thing any screen loads at once: the calendar's
 * month of events.
 */
export const MAX_PAGE_LIMIT = 500

/**
 * Whether the caller wants to be told how many rows match in total. Counting
 * means looking at every matching row, far more work than fetching the page
 * itself, so a screen that prints "601–700 of 3400" asks for it and a list
 * that just keeps scrolling does not.
 */
export const CountMode = Schema.Literals(['exact', 'none'])

/**
 * Whole numbers only, and within the ceiling. A page size arrives from a URL
 * as text, and plain number parsing would let "abc" and "2.5" through to the
 * database as nonsense.
 */
const PageLimit = Schema.FiniteFromString.pipe(
	Schema.check(
		Schema.isInt(),
		Schema.isBetween({ minimum: 1, maximum: MAX_PAGE_LIMIT }),
	),
)

/** How far into the list to start. Never negative. */
const PageOffset = Schema.FiniteFromString.pipe(
	Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
)

/**
 * Spread into a list endpoint's `query` so every list is asked for the same
 * way, and so the ceiling shows up in the published API description instead
 * of being a rule callers only discover by being refused.
 */
export const pageQuery = {
	limit: Schema.optional(PageLimit),
	offset: Schema.optional(PageOffset),
	count: Schema.optional(CountMode),
} as const

/**
 * Wire envelope for a paginated list endpoint: one page of items, the
 * `limit`/`offset` that produced it, whether asking again would bring anything
 * more, and how many rows match in total. `total` is null when the caller asked
 * not to be told, which is not the same as "none matched"; `hasMore` is always
 * filled in, so a list can page without ever paying for a count.
 */
export const PaginatedList = <S extends Schema.Top>(item: S) =>
	Schema.Struct({
		items: Schema.Array(item),
		total: Schema.NullOr(Schema.Number),
		limit: Schema.Number,
		offset: Schema.Number,
		hasMore: Schema.Boolean,
	})
