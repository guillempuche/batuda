import { Schema } from 'effect'

/** Freeform research — no structured output, markdown brief only. */
export const FreeformSchema = Schema.Struct({
	proposed_updates: Schema.optional(
		Schema.Array(
			Schema.Struct({
				subject_table: Schema.Literals(['companies', 'contacts']),
				subject_id: Schema.String,
				expected_version: Schema.Number,
				fields: Schema.Unknown,
				reason: Schema.String,
				citations: Schema.Array(
					Schema.Struct({
						source_id: Schema.String,
						quote: Schema.optional(Schema.String),
					}),
				),
			}),
		),
	),
	pending_paid_actions: Schema.optional(
		Schema.Array(
			Schema.Struct({
				tool: Schema.String,
				args: Schema.Unknown,
				estimated_cents: Schema.Number,
				reason: Schema.String,
			}),
		),
	),
})
