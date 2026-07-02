import { Schema } from 'effect'

import { VerificationVerdict } from '../../domain/types'

const Citation = Schema.Struct({
	source_id: Schema.String,
	quote: Schema.optionalKey(Schema.String),
	confidence: Schema.optionalKey(Schema.Number),
})

export const ContactDiscoveryV1Schema = Schema.Struct({
	contacts: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			role: Schema.optionalKey(Schema.String),
			is_decision_maker: Schema.optionalKey(Schema.Boolean),
			// Open channel list (email, phone, linkedin, x, website, bluesky, …).
			// Only the email channel carries a deliverability verdict + confidence.
			channels: Schema.optionalKey(
				Schema.Array(
					Schema.Struct({
						kind: Schema.String,
						value: Schema.String,
						verification: Schema.optionalKey(VerificationVerdict),
						confidence: Schema.optionalKey(Schema.Number),
						is_primary: Schema.optionalKey(Schema.Boolean),
					}),
				),
			),
			notes: Schema.optionalKey(Schema.String),
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
