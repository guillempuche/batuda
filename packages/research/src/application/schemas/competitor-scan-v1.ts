import { Schema } from 'effect'

const Citation = Schema.Struct({
	source_id: Schema.String,
	quote: Schema.optional(Schema.String),
	confidence: Schema.optional(Schema.Number),
})

export const CompetitorScanV1Schema = Schema.Struct({
	competitors: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			website: Schema.optional(Schema.String),
			description: Schema.optional(Schema.String),
			strengths: Schema.optional(Schema.Array(Schema.String)),
			weaknesses: Schema.optional(Schema.Array(Schema.String)),
			overlap: Schema.optional(Schema.String),
			citations: Schema.Array(Citation),
		}),
	),
	market_summary: Schema.optional(
		Schema.Struct({
			total_competitors_found: Schema.Number,
			market_maturity: Schema.optional(Schema.String),
			key_differentiators: Schema.optional(Schema.Array(Schema.String)),
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
