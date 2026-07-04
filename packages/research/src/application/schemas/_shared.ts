import { Schema, SchemaGetter } from 'effect'

/**
 * Building blocks shared across the structured research output schemas, so each
 * shape is defined once instead of copied into every file.
 *
 * No `identifier` annotation on purpose: it would emit each shape as a named
 * reference, and some output paths keep only a schema's top-level shape, so a
 * reference to a separately-named fragment would be dropped there.
 */

// Open-ended maps (`fields`, `args`) arrive as a JSON-encoded string (OpenAI
// structured output has no "any shape" type). Open-weights models sometimes
// emit prose here, so decoding falls back to the raw string instead of failing
// the whole extraction; valid JSON still decodes to an object.
const parseJsonOrRaw = (value: string): unknown => {
	try {
		return JSON.parse(value)
	} catch {
		return value
	}
}

export const TolerantJsonString = Schema.String.annotate({
	description: 'a string that will be decoded as JSON',
}).pipe(
	Schema.decodeTo(Schema.Unknown, {
		decode: SchemaGetter.transform(parseJsonOrRaw),
		encode: SchemaGetter.stringifyJson(),
	}),
)

export const Citation = Schema.Struct({
	source_id: Schema.String,
	quote: Schema.optionalKey(Schema.String),
	confidence: Schema.optionalKey(Schema.Number),
})

export const DiscoveredExisting = Schema.Struct({
	subject_table: Schema.Literals(['companies', 'contacts']),
	subject_id: Schema.String,
	name: Schema.String,
})

export const ProposedUpdate = Schema.Struct({
	subject_table: Schema.Literals(['companies', 'contacts']),
	subject_id: Schema.String,
	expected_version: Schema.Number,
	fields: TolerantJsonString,
	reason: Schema.String,
	citations: Schema.Array(Citation),
})

export const PendingPaidAction = Schema.Struct({
	tool: Schema.String,
	args: TolerantJsonString,
	estimated_cents: Schema.Number,
	reason: Schema.String,
})
