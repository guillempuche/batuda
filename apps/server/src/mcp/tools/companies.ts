import { DateTime, Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

import { CompanyService } from '../../services/companies'
import { Geocoder } from '../../services/geocoder'

const SearchCompanies = Tool.make('search_companies', {
	description:
		'Filter companies by status, region, industry, priority, or search query. Returns summaries only — call get_company for full details.',
	parameters: Schema.Struct({
		status: Schema.optional(Schema.String),
		region: Schema.optional(Schema.String),
		industry: Schema.optional(Schema.String),
		priority: Schema.optional(Schema.Number),
		product_fit: Schema.optional(Schema.String),
		query: Schema.optional(Schema.String),
		limit: Schema.optional(Schema.Number),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Search Companies')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const GetCompany = Tool.make('get_company', {
	description:
		'Get full company profile including contacts and last 5 interactions. Use the slug or ID.',
	parameters: Schema.Struct({
		id_or_slug: Schema.String,
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Get Company')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const CreateCompany = Tool.make('create_company', {
	description:
		'Create a new company. Slug: unique kebab-case from name. Status: prospect|lead|qualified|proposal|negotiation|client|closed|dead (default: prospect). Priority: 1 (highest) to 5 (lowest, default: 2).',
	parameters: Schema.Struct({
		name: Schema.String,
		slug: Schema.String,
		status: Schema.optional(Schema.String),
		industry: Schema.optional(Schema.String),
		sizeRange: Schema.optional(Schema.String),
		region: Schema.optional(Schema.String),
		location: Schema.optional(Schema.String),
		source: Schema.optional(Schema.String),
		priority: Schema.optional(Schema.Number),
		website: Schema.optional(Schema.String),
		email: Schema.optional(Schema.String),
		phone: Schema.optional(Schema.String),
		instagram: Schema.optional(Schema.String),
		linkedin: Schema.optional(Schema.String),
		googleMapsUrl: Schema.optional(Schema.String),
		productsFit: Schema.optional(Schema.Array(Schema.String)),
		tags: Schema.optional(Schema.Array(Schema.String)),
		painPoints: Schema.optional(Schema.String),
		currentTools: Schema.optional(Schema.String),
		nextAction: Schema.optional(Schema.String),
		nextActionAt: Schema.optional(Schema.String),
		latitude: Schema.optional(Schema.Number),
		longitude: Schema.optional(Schema.Number),
		geocodedAt: Schema.optional(Schema.String),
		geocodeSource: Schema.optional(Schema.String),
		metadata: Schema.optional(Schema.Unknown),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Create Company')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const UpdateCompany = Tool.make('update_company', {
	description:
		'Update one or more fields on an existing company by UUID. Only include fields to change; omitted fields stay unchanged.',
	parameters: Schema.Struct({
		id: Schema.String,
		name: Schema.optional(Schema.String),
		status: Schema.optional(Schema.String),
		industry: Schema.optional(Schema.String),
		sizeRange: Schema.optional(Schema.String),
		region: Schema.optional(Schema.String),
		location: Schema.optional(Schema.String),
		source: Schema.optional(Schema.String),
		priority: Schema.optional(Schema.Number),
		website: Schema.optional(Schema.String),
		email: Schema.optional(Schema.String),
		phone: Schema.optional(Schema.String),
		instagram: Schema.optional(Schema.String),
		linkedin: Schema.optional(Schema.String),
		googleMapsUrl: Schema.optional(Schema.String),
		productsFit: Schema.optional(Schema.Array(Schema.String)),
		tags: Schema.optional(Schema.Array(Schema.String)),
		painPoints: Schema.optional(Schema.String),
		currentTools: Schema.optional(Schema.String),
		nextAction: Schema.optional(Schema.String),
		nextActionAt: Schema.optional(Schema.String),
		latitude: Schema.optional(Schema.Number),
		longitude: Schema.optional(Schema.Number),
		geocodedAt: Schema.optional(Schema.String),
		geocodeSource: Schema.optional(Schema.String),
		metadata: Schema.optional(Schema.Unknown),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Update Company')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const GeocodeCompany = Tool.make('geocode_company', {
	description:
		'Resolve a company to latitude/longitude via the configured geocoder (Nominatim). Persists lat/lng/geocoded_at/geocode_source and returns the updated row. Rate-limited to 1 req/sec.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Geocode Company')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, true)

export const CompanyTools = Toolkit.make(
	SearchCompanies,
	GetCompany,
	CreateCompany,
	UpdateCompany,
	GeocodeCompany,
)

export const CompanyHandlersLive = CompanyTools.toLayer(
	Effect.gen(function* () {
		const service = yield* CompanyService
		const geocoder = yield* Geocoder
		return {
			search_companies: params =>
				Effect.gen(function* () {
					return yield* service.search({
						status: params.status,
						region: params.region,
						industry: params.industry,
						priority: params.priority,
						productFit: params.product_fit,
						query: params.query,
						limit: params.limit,
					})
				}).pipe(Effect.orDie),
			get_company: ({ id_or_slug }) =>
				service.getWithRelations(id_or_slug).pipe(
					Effect.catchTag('NotFound', () => service.findById(id_or_slug)),
					Effect.orDie,
				),
			create_company: params =>
				Effect.gen(function* () {
					const rows = yield* service.create(params as any)
					return rows[0]
				}).pipe(Effect.orDie),
			update_company: ({ id, ...fields }) =>
				Effect.gen(function* () {
					const rows = yield* service.update(id, fields as any)
					return rows[0]
				}).pipe(Effect.orDie),
			geocode_company: ({ id }) =>
				Effect.gen(function* () {
					const company = yield* service.findById(id)
					const name = company['name'] as string | null
					const location = company['location'] as string | null
					const query = [name, location].filter(Boolean).join(', ')
					if (!query) return null
					const hit = yield* geocoder.lookup(query)
					if (!hit) return null
					const rows = yield* service.update(id, {
						latitude: hit.latitude,
						longitude: hit.longitude,
						geocodedAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
						geocodeSource: hit.source,
					})
					return rows[0]
				}).pipe(Effect.orDie),
		}
	}),
)
