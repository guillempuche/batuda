import { Schema } from 'effect'

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
