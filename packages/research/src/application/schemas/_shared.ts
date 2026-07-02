import { Schema } from 'effect'

/**
 * Building blocks shared across the structured research output schemas, so each
 * shape is defined once instead of copied into every file.
 *
 * No `identifier` annotation on purpose: it would emit each shape as a named
 * reference, and some output paths keep only a schema's top-level shape, so a
 * reference to a separately-named fragment would be dropped there.
 */

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
	// Open-ended field map; sent as a JSON-encoded string because OpenAI
	// structured output has no "any shape" type — decodes back to an object
	// automatically.
	fields: Schema.UnknownFromJsonString,
	reason: Schema.String,
	citations: Schema.Array(Citation),
})

export const PendingPaidAction = Schema.Struct({
	tool: Schema.String,
	// Same open-ended-map rationale as `fields` above.
	args: Schema.UnknownFromJsonString,
	estimated_cents: Schema.Number,
	reason: Schema.String,
})
