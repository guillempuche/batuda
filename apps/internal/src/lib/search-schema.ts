import { Option, Schema } from 'effect'

/**
 * Build a TanStack Router `validateSearch` that decodes each URL param
 * independently — one malformed param never invalidates its neighbors.
 *
 * Why per-field: applying `decodeUnknownOption` to a whole `Schema.Struct`
 * fails the struct when any field fails (`Issue.Composite` short-circuits
 * in `SchemaAST.ts`). URL params are user-typed and can be stale across
 * deploys, so `?status=xyzzy&query=acme` must still surface `query`.
 *
 * Missing fields are omitted from the result (no `{ field: undefined }`)
 * so the shape satisfies `exactOptionalPropertyTypes` downstream.
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
			try {
				const decoded = decode(raw[key])
				if (Option.isSome(decoded)) {
					out[key] = decoded.value
				}
			} catch {
				// A decoder may throw (e.g. `NumberFromString` on `"NaN"`);
				// swallow so sibling fields survive.
			}
		}
		return out as {
			readonly [K in keyof Fields]?: Fields[K]['Type']
		}
	}
}
