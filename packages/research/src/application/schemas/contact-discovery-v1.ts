import { Schema } from 'effect'

const Citation = Schema.Struct({
	source_id: Schema.String,
	quote: Schema.optional(Schema.String),
	confidence: Schema.optional(Schema.Number),
})

export const ContactDiscoveryV1Schema = Schema.Struct({
	contacts: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			role: Schema.optional(Schema.String),
			email: Schema.optional(Schema.String),
			phone: Schema.optional(Schema.String),
			linkedin: Schema.optional(Schema.String),
			is_decision_maker: Schema.optional(Schema.Boolean),
			notes: Schema.optional(Schema.String),
			citations: Schema.Array(Citation),
		}),
	),
	discovered_existing: Schema.optional(
		Schema.Array(
			Schema.Struct({
				subject_table: Schema.Literals(['companies', 'contacts']),
				subject_id: Schema.String,
				name: Schema.String,
			}),
		),
	),
	proposed_updates: Schema.optional(
		Schema.Array(
			Schema.Struct({
				subject_table: Schema.Literals(['companies', 'contacts']),
				subject_id: Schema.String,
				expected_version: Schema.Number,
				fields: Schema.Unknown,
				reason: Schema.String,
				citations: Schema.Array(Citation),
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
