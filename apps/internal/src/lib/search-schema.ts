import { Option, Schema } from 'effect'

import { CommaList } from '@batuda/controllers'

/**
 * Build a TanStack Router `validateSearch` that reads each address param on its
 * own — one malformed param never invalidates its neighbours.
 *
 * Why per-field: handing a whole `Schema.Struct` to `decodeUnknownOption` fails
 * the struct as soon as one field fails, and address params are typed by hand
 * and go stale across deploys, so `?status=xyzzy&query=acme` still has to
 * surface `query`.
 *
 * Two habits of the router decide the rest of this.
 *
 * It reads every param as JSON before this runs, so a hand-typed
 * `?attributeValue=2` arrives as the number 2 and `?query=2024` as the number
 * 2024. A field that takes text alone would drop both, though the digits are
 * plainly what was meant, so a number or a yes/no is offered again as its own
 * text before being given up on.
 *
 * It also lays what comes back from here over the raw address — `{ ...raw,
 * ...validated }` — so a key left out of the answer returns as whatever JSON
 * made of it, and the page would go on filtering by the very value it refused.
 * A param that cannot be read is therefore answered with `undefined` instead of
 * being left out: it covers the raw one, and nothing sees it afterwards, since
 * every filter in the app skips an undefined value and so does the router's own
 * address writer.
 *
 * A param the address does not carry at all stays absent, so the shape keeps
 * satisfying `exactOptionalPropertyTypes` downstream.
 */
export function validateSearchWith<
	const Fields extends Record<string, Schema.Top>,
>(
	fields: Fields,
): (raw: Record<string, unknown>) => {
	readonly [K in keyof Fields]?: Fields[K]['Type']
} {
	const decoders = Object.entries(fields).map(
		([key, schema]) =>
			[
				key,
				Schema.decodeUnknownOption(schema as Schema.Codec<unknown>),
			] as const,
	)
	return raw => {
		const out: Record<string, unknown> = {}
		for (const [key, decode] of decoders) {
			const value = raw[key]
			if (value === undefined) continue
			const read = tryDecode(decode, value)
			const decoded =
				Option.isNone(read) &&
				(typeof value === 'number' || typeof value === 'boolean')
					? tryDecode(decode, String(value))
					: read
			out[key] = Option.isSome(decoded) ? decoded.value : undefined
		}
		return out as {
			readonly [K in keyof Fields]?: Fields[K]['Type']
		}
	}
}

// A decoder may throw rather than answer, and a throw here would take the
// sibling params down with it.
function tryDecode(
	decode: (input: unknown) => Option.Option<unknown>,
	value: unknown,
): Option.Option<unknown> {
	try {
		return decode(value)
	} catch {
		return Option.none()
	}
}

/**
 * A filter that holds several values, each of them one of a fixed set of words.
 *
 * It has to read two shapes. A link somebody wrote, or one this app built,
 * carries the values comma-separated in a single param; the router's own
 * round-trip of what it last put in the address hands them back as a list. Both
 * mean the same filter, so both decode to the same list of words.
 *
 * `CommaList` does the splitting, rather than a second copy of the rule here:
 * one splitting rule means a value trimmed one way everywhere, on the link the
 * server reads and on the one the browser builds.
 *
 * A word outside the set fails the whole list, which `validateSearchWith` turns
 * into a filter holding nothing. `?status=open,xyzzy` therefore shows every
 * conversation rather than only the open ones — the filter is refused as a
 * whole, so nothing is silently dropped from what was asked for.
 */
export function valueListOf<M extends Schema.Top>(member: M) {
	return Schema.Union([
		Schema.Array(member),
		CommaList.pipe(Schema.decodeTo(Schema.Array(member))),
	])
}
