import { Schema, SchemaGetter } from 'effect'

import { ResearchSubjectTable } from '@batuda/domain'

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
//
// The wire type is `Finite | String | Null` (not a bare `Schema.Number`, whose
// NaN/Infinity encoding serialises to a nested anyOf a strict provider rejects,
// and with `Null` folded in so this stays a single non-nested union even when a
// field is required + nullable).
const coerceFinite = (value: number | string | null): number | null => {
	if (value === null) return null
	const n =
		typeof value === 'string'
			? value.trim() === ''
				? Number.NaN // Number('') is 0; treat a blank string as "no value", not zero.
				: Number(value)
			: value
	return Number.isFinite(n) ? n : null
}

const lenientNumberWire = Schema.Union([
	Schema.Finite,
	Schema.String,
	Schema.Null,
])

const readAsNumber = (wire: typeof lenientNumberWire) =>
	wire.pipe(
		Schema.decodeTo(Schema.NullOr(Schema.Number), {
			decode: SchemaGetter.transform(coerceFinite),
			encode: SchemaGetter.transform((n: number | null) => n),
		}),
	)

export const LenientNumber = readAsNumber(lenientNumberWire)

/**
 * The same lenient number, carrying a note that explains the field to the model.
 *
 * The note goes on the shape a number travels in, not on the finished field:
 * what the model is told about a field is built from that travelling shape, so
 * a note put anywhere else is silently dropped from what the model reads.
 */
export const describedLenientNumber = (description: string) =>
	readAsNumber(lenientNumberWire.annotate({ description }))

export const Citation = Schema.Struct({
	source_id: Schema.String,
	quote: Schema.optionalKey(Schema.String),
	// Required + nullable, not optional: `optionalKey` around a union serialises
	// to a nested anyOf a strict provider rejects. LenientNumber already carries
	// null, so a model with no confidence sends null.
	confidence: LenientNumber,
})

// A single field paired with the source that backs it: a value plus the same
// { source_id, quote?, confidence? } a citation carries. This lets each extracted
// field own its own evidence — industry from this page, a phone from that one —
// instead of one citation list for a whole block, so a single unsupported field
// can be dropped on its own without discarding its neighbours.
export const Sourced = <Value extends Schema.Top>(value: Value) =>
	Schema.Struct({ value, ...Citation.fields })

export const DiscoveredExisting = Schema.Struct({
	subject_table: ResearchSubjectTable,
	subject_id: Schema.String,
	name: Schema.String,
})

export const ProposedUpdate = Schema.Struct({
	subject_table: ResearchSubjectTable,
	// 'create' inserts a newly discovered row (contacts only); the default,
	// 'update', applies the fields to an existing row. A create carries the new
	// row's data in `fields` and omits subject_id/expected_version (there is no
	// row yet); an update keeps requiring them (the apply path rejects one that
	// leaves them out).
	operation: Schema.optionalKey(Schema.Literals(['create', 'update'])),
	subject_id: Schema.optionalKey(Schema.String),
	// Required + nullable (see Citation.confidence): a 'create' carries null here.
	expected_version: LenientNumber,
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
