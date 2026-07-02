import { Schema } from 'effect'

const Citation = Schema.Struct({
	source_id: Schema.String,
	quote: Schema.optionalKey(Schema.String),
	confidence: Schema.optionalKey(Schema.Number),
})

export const ProspectScanV1Schema = Schema.Struct({
	prospects: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			website: Schema.optionalKey(Schema.String),
			tax_id: Schema.optionalKey(Schema.String),
			industry: Schema.optionalKey(Schema.String),
			region: Schema.optionalKey(Schema.String),
			why_relevant: Schema.String,
			pain_indicators: Schema.optionalKey(Schema.Array(Schema.String)),
			citations: Schema.Array(Citation),
		}),
	),
	discovered_existing: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				subject_table: Schema.Literals(['companies', 'contacts']),
				subject_id: Schema.String,
				name: Schema.String,
			}),
		),
	),
	proposed_updates: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				subject_table: Schema.Literals(['companies', 'contacts']),
				subject_id: Schema.String,
				expected_version: Schema.Number,
				// Open-ended field map; sent as a JSON-encoded string because OpenAI
				// structured output has no "any shape" type — decodes back to an
				// object automatically.
				fields: Schema.UnknownFromJsonString,
				reason: Schema.String,
				citations: Schema.Array(Citation),
			}),
		),
	),
	pending_paid_actions: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				tool: Schema.String,
				// Same open-ended-map rationale as `fields` above.
				args: Schema.UnknownFromJsonString,
				estimated_cents: Schema.Number,
				reason: Schema.String,
			}),
		),
	),
})
