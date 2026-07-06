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

// Numeric fields the model fills in. Open-weights models sometimes return the
// text "NaN" or "Infinity" for a number they could not work out; strict
// decoding rejects that string and fails the whole extraction. Accepting a
// string on the wire lets decoding turn any non-finite value into "no value"
// (null) instead — the same family of fix as TolerantJsonString above.
const coerceFinite = (value: number | string): number | null => {
	const n =
		typeof value === 'string'
			? value.trim() === ''
				? Number.NaN // Number('') is 0; treat a blank string as "no value", not zero.
				: Number(value)
			: value
	return Number.isFinite(n) ? n : null
}

export const LenientNumber = Schema.Union([Schema.Number, Schema.String]).pipe(
	Schema.decodeTo(Schema.NullOr(Schema.Number), {
		decode: SchemaGetter.transform(coerceFinite),
		encode: SchemaGetter.transform((n: number | null) => n ?? Number.NaN),
	}),
)

export const Citation = Schema.Struct({
	source_id: Schema.String,
	quote: Schema.optionalKey(Schema.String),
	confidence: Schema.optionalKey(LenientNumber),
})

export const DiscoveredExisting = Schema.Struct({
	subject_table: Schema.Literals(['companies', 'contacts']),
	subject_id: Schema.String,
	name: Schema.String,
})

export const ProposedUpdate = Schema.Struct({
	subject_table: Schema.Literals(['companies', 'contacts']),
	// 'create' inserts a newly discovered row (contacts only); the default,
	// 'update', applies the fields to an existing row. A create carries the new
	// row's data in `fields` and omits subject_id/expected_version (there is no
	// row yet); an update keeps requiring them (the apply path rejects one that
	// leaves them out).
	operation: Schema.optionalKey(Schema.Literals(['create', 'update'])),
	subject_id: Schema.optionalKey(Schema.String),
	expected_version: Schema.optionalKey(LenientNumber),
	fields: TolerantJsonString,
	reason: Schema.String,
	citations: Schema.Array(Citation),
})

export const PendingPaidAction = Schema.Struct({
	tool: Schema.String,
	args: TolerantJsonString,
	estimated_cents: LenientNumber,
	reason: Schema.String,
})
