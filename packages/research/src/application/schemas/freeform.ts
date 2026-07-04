import { Schema } from 'effect'

import { TolerantJsonString } from './_shared'

/** Freeform research — no structured output, markdown brief only. */
export const FreeformSchema = Schema.Struct({
	proposed_updates: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				subject_table: Schema.Literals(['companies', 'contacts']),
				subject_id: Schema.String,
				expected_version: Schema.Number,
				fields: TolerantJsonString,
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
				args: TolerantJsonString,
				estimated_cents: Schema.Number,
				reason: Schema.String,
			}),
		),
	),
})
