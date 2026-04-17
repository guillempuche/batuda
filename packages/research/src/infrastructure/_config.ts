import { Config, Schema, SchemaGetter } from 'effect'

/**
 * Decode a CSV env-var value into a non-empty array of literal vendor names.
 * Slot 1 value of a `RESEARCH_PROVIDER_*` variable — accepts `"brave"` or
 * `"brave,firecrawl"`. Empty and unknown values fail at boot.
 *
 * Composed in two stages so each getter matches its target's encoded type:
 *   1. `String → Array<String>` — trims whitespace, drops empties.
 *   2. `Array<String> → NonEmptyArray<Literal>` — vendor-membership + size check.
 */
export const providerListConfig = <const V extends ReadonlyArray<string>>(
	vendors: V,
	envName: string,
) => {
	const schema = Schema.String.pipe(
		Schema.decodeTo(Schema.Array(Schema.String), {
			decode: SchemaGetter.transform((raw: string) =>
				raw
					.split(',')
					.map(v => v.trim())
					.filter(v => v.length > 0),
			),
			encode: SchemaGetter.transform((arr: ReadonlyArray<string>) =>
				arr.join(','),
			),
		}),
		Schema.decodeTo(Schema.NonEmptyArray(Schema.Literals(vendors))),
	)
	return Config.schema(schema, envName)
}

/**
 * Index-suffixed env var name. Slot 0 is the unsuffixed base; slot N (≥ 1)
 * is `${base}_${N + 1}` — e.g. `RESEARCH_API_KEY_SEARCH_2` for slot 1.
 */
export const keyForSlot = (base: string, slot: number): string =>
	slot === 0 ? base : `${base}_${slot + 1}`
