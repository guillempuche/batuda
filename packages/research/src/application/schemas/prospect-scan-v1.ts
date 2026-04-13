import { Schema } from 'effect'

const Citation = Schema.Struct({
	source_id: Schema.String,
	quote: Schema.optional(Schema.String),
	confidence: Schema.optional(Schema.Number),
})

export const ProspectScanV1Schema = Schema.Struct({
	prospects: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			website: Schema.optional(Schema.String),
			tax_id: Schema.optional(Schema.String),
			industry: Schema.optional(Schema.String),
			region: Schema.optional(Schema.String),
			why_relevant: Schema.String,
			pain_indicators: Schema.optional(Schema.Array(Schema.String)),
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
