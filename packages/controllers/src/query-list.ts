import { Schema, SchemaGetter } from 'effect'

/**
 * Several values for one filter, written as a single comma-separated value on
 * the link.
 *
 * A query string has no way of its own to carry a list, and a repeated key is
 * read differently by each client, so the list travels as text and is split
 * here. Blanks are dropped, so a trailing comma or a value somebody cleared
 * costs nothing.
 *
 * One codec, used by the routes and by the browser that builds their links: two
 * copies of a splitting rule are two rules, and they disagree the first time one
 * of them trims differently.
 */
export const CommaList = Schema.String.pipe(
	Schema.decodeTo(Schema.Array(Schema.String), {
		decode: SchemaGetter.transform((raw: string) =>
			raw
				.split(',')
				.map(value => value.trim())
				.filter(value => value.length > 0),
		),
		encode: SchemaGetter.transform((values: ReadonlyArray<string>) =>
			values.join(','),
		),
	}),
)
