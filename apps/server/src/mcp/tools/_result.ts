import { Schema } from 'effect'

import { MAX_PAGE_LIMIT } from '@batuda/controllers'

// How many rows a tool may ask for. Anything above the ceiling is refused
// rather than quietly trimmed: an assistant that asks for a thousand and
// silently receives five hundred has no way to tell, and would report the five
// hundred as the whole answer. The ceiling reaches the assistant too, since it
// is published in the tool's own parameter description.
export const McpPageLimit = Schema.Number.pipe(
	Schema.check(
		Schema.isInt(),
		Schema.isBetween({ minimum: 1, maximum: MAX_PAGE_LIMIT }),
	),
)

// How far into the list to start. Never negative.
export const McpPageOffset = Schema.Number.pipe(
	Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
)

// Many tools naturally return a list, but the MCP standard requires a tool's
// structured output to be a JSON object — strict clients reject a bare array
// and hide the tool. Wrapping each list as `{ items }` keeps the result valid.
// Pair this schema with `toItems` on the handler's returned array.
export const ListResult = (item: Schema.Top) =>
	Schema.Struct({ items: Schema.Array(item) })

export const toItems = <A>(
	items: ReadonlyArray<A>,
): { items: ReadonlyArray<A> } => ({
	items,
})

// One page of a list, for tools whose service already pages. `hasMore` is the
// field an assistant has to act on: twenty-five rows read the same whether that
// is the whole answer or the first slice of three hundred, so without it the
// assistant answers "you have twenty-five" — wrong, plausible, and invisible to
// the person reading it.
//
// No total, on purpose: an assistant needs to know whether to ask again, not
// how many rows exist, and a count that is usually absent has to describe
// itself as "a number or nothing" — a choice inside a choice, which some model
// providers reject outright rather than read.
export const PageResult = (item: Schema.Top) =>
	Schema.Struct({
		items: Schema.Array(item),
		limit: Schema.Number,
		offset: Schema.Number,
		hasMore: Schema.Boolean,
	})

// Copies out exactly the fields the result promises, so a service that carries
// extra working state alongside its page cannot leak it to a caller.
export const toPage = <A>(page: {
	readonly items: ReadonlyArray<A>
	readonly limit: number
	readonly offset: number
	readonly hasMore: boolean
}): {
	items: ReadonlyArray<A>
	limit: number
	offset: number
	hasMore: boolean
} => ({
	items: page.items,
	limit: page.limit,
	offset: page.offset,
	hasMore: page.hasMore,
})

// Rows a tool fetched itself rather than through a paging service, where the
// only question worth answering is whether it stopped short of everything.
export const TruncatableResult = (item: Schema.Top) =>
	Schema.Struct({
		items: Schema.Array(item),
		hasMore: Schema.Boolean,
	})

// Trims a batch down to `limit` and reports what was left off. Hand it either
// one row more than was asked for, or the whole set when it is already in
// memory — the surplus is the signal, and it never reaches the caller.
export const toTruncatable = <A>(
	rows: ReadonlyArray<A>,
	limit: number,
): { items: ReadonlyArray<A>; hasMore: boolean } => ({
	items: rows.slice(0, limit),
	hasMore: rows.length > limit,
})
