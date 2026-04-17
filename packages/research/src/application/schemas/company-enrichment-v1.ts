import { Schema } from 'effect'

const Citation = Schema.Struct({
	source_id: Schema.String,
	quote: Schema.optional(Schema.String),
	confidence: Schema.optional(Schema.Number),
})

export const CompanyEnrichmentV1Schema = Schema.Struct({
	enrichment: Schema.Struct({
		industry: Schema.optional(Schema.String),
		size_range: Schema.optional(Schema.String),
		pain_points: Schema.optional(Schema.String),
		current_tools: Schema.optional(Schema.String),
		products_fit: Schema.optional(Schema.Array(Schema.String)),
		tags: Schema.optional(Schema.Array(Schema.String)),
		location: Schema.optional(Schema.String),
		region: Schema.optional(Schema.String),
		address: Schema.optional(Schema.String),
		latitude: Schema.optional(Schema.Number),
		longitude: Schema.optional(Schema.Number),
		citations: Schema.Array(Citation),
	}),
	competitors: Schema.optional(
		Schema.Array(
			Schema.Struct({
				name: Schema.String,
				website: Schema.optional(Schema.String),
				why: Schema.optional(Schema.String),
				citations: Schema.Array(Citation),
			}),
		),
	),
	contacts: Schema.optional(
		Schema.Array(
			Schema.Struct({
				name: Schema.String,
				role: Schema.optional(Schema.String),
				email: Schema.optional(Schema.String),
				phone: Schema.optional(Schema.String),
				citations: Schema.Array(Citation),
			}),
		),
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
