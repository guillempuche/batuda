import { Schema } from 'effect'

/** Freeform research — no structured output, markdown brief only. */
export const FreeformSchema = Schema.Struct({
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
				citations: Schema.Array(
					Schema.Struct({
						source_id: Schema.String,
						quote: Schema.optionalKey(Schema.String),
					}),
				),
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
