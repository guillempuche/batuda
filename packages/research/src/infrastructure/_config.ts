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
	defaultValue?: ReadonlyArray<V[number]> & { readonly 0: V[number] },
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
	const config = Config.schema(schema, envName)
	return defaultValue === undefined
		? config
		: config.pipe(Config.withDefault(defaultValue))
}

/**
 * Whether to go past the caches and ask the provider every time.
 *
 * Off everywhere but a measuring run. A pass that repeats a company to average away
 * the noise between runs gets the first run's answer back for free otherwise, and
 * averaging one answer with itself steadies nothing — the repeat has to reach the
 * providers again to be a repeat at all.
 *
 * It skips the reads only. What a run finds is still written down, because the pages
 * it opened are the evidence its findings cite, not merely something kept to save a
 * fetch later.
 */
export const cacheBypassConfig = Config.boolean('RESEARCH_CACHE_BYPASS').pipe(
	Config.withDefault(false),
)

/**
 * Index-suffixed env var name. Slot 0 is the unsuffixed base; slot N (≥ 1)
 * is `${base}_${N + 1}` — e.g. `RESEARCH_API_KEY_SEARCH_2` for slot 1.
 */
export const keyForSlot = (base: string, slot: number): string =>
	slot === 0 ? base : `${base}_${slot + 1}`
