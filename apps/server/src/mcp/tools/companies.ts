import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CompanyDetail, CurrentOrg } from '@batuda/controllers'
import { Company } from '@batuda/domain'

import { CompanyService } from '../../services/companies'
import { withBriefOwnership } from '../../services/company-brief'
import {
	geocodeCompany,
	updateCompanyRegeocoding,
} from '../../services/company-geocoding'
import { recordStageChange } from '../../services/company-stage-change'
import { Geocoder } from '../../services/geocoder'
import { TimelineActivityService } from '../../services/timeline-activity'
import { CurrentUser } from '../current-user'
import { ListResult, toItems } from './_result'

const REQUEST_DEPENDENCIES = [CurrentOrg, CurrentUser]

// Slugs from a create-batch that produced no new row: those whose slug already
// existed, plus every repeat beyond the first within the same call (the unique
// constraint lets only one of a duplicated slug land, so the rest are skips).
// Exported for its unit test.
export const skippedCreateSlugs = (
	requestedSlugs: ReadonlyArray<string>,
	landedSlugs: ReadonlySet<string>,
): string[] => {
	const accounted = new Set<string>()
	const skipped: string[] = []
	for (const slug of requestedSlugs) {
		if (landedSlugs.has(slug) && !accounted.has(slug)) accounted.add(slug)
		else skipped.push(slug)
	}
	return skipped
}

const SearchCompanies = Tool.make('search_companies', {
	description:
		'Filter companies by status, country (ISO 3166-1 alpha-2, e.g. US/ES/DE), industry, priority, search query, the research fit verdict (strong_fit / possible_fit / weak_fit / no_fit), a fit criterion the company passed (matched loosely against the criterion text), or a geographic bounding box. The box is any subset of min_lat/max_lat/min_lng/max_lng (decimal degrees); each bound is applied independently and only matches companies with stored coordinates. Returns summaries (including latitude/longitude) — call get_company for full details.',
	parameters: Schema.Struct({
		status: Schema.optional(Schema.String),
		country: Schema.optional(Schema.String),
		industry: Schema.optional(Schema.String),
		priority: Schema.optional(Schema.Number),
		product_fit: Schema.optional(Schema.String),
		fit_verdict: Schema.optional(Schema.String),
		fit_criterion_passed: Schema.optional(Schema.String),
		query: Schema.optional(Schema.String),
		min_lat: Schema.optional(Schema.Number),
		max_lat: Schema.optional(Schema.Number),
		min_lng: Schema.optional(Schema.Number),
		max_lng: Schema.optional(Schema.Number),
		limit: Schema.optional(Schema.Number),
	}),
	success: ListResult(Company.json),
	dependencies: REQUEST_DEPENDENCIES,
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
	success: Schema.Union([CompanyDetail, Company.json]),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Get Company')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// The fields a new company carries — one array element of a create_companies call.
const companyInputFields = {
	name: Schema.String,
	slug: Schema.String,
	status: Schema.optional(Schema.String),
	industry: Schema.optional(Schema.String),
	sizeRange: Schema.optional(Schema.String),
	country: Schema.optional(Schema.String),
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
}
const CompanyInput = Schema.Struct(companyInputFields)

const CreateCompanies = Tool.make('create_companies', {
	description:
		'Create one or more companies in a single call — pass `companies` as an array (a single element to create just one, the whole shortlist to load a batch). Slug: unique kebab-case from name. Status: prospect|lead|qualified|proposal|negotiation|client|closed|dead (default: prospect). Priority: 1 (highest) to 5 (lowest, default: 2). Runs in one transaction; a company whose slug already exists is skipped (not an error), so re-running an overlapping list is safe. Returns { created, skipped_slugs }: the rows that landed, and the slugs that already existed.',
	parameters: Schema.Struct({
		companies: Schema.Array(CompanyInput),
	}),
	success: Schema.Struct({
		created: Schema.Array(Company.json),
		skipped_slugs: Schema.Array(Schema.String),
	}),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Create Companies')
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
		country: Schema.optional(Schema.String),
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
		accountBrief: Schema.optional(
			Schema.String.annotate({
				description:
					"The account's running notes, in markdown. Editing these as a person takes ownership of them, so later research adds to them instead of replacing them.",
			}),
		),
		metadata: Schema.optional(Schema.Unknown),
	}),
	success: Schema.NullOr(Company.json),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Update Company')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const GeocodeCompany = Tool.make('geocode_company', {
	description:
		'Resolve a company to latitude/longitude via the configured geocoder (Nominatim). On a match, persists lat/lng/geocoded_at/geocode_source. Returns { outcome, company }: outcome is "geocoded" (company is the updated row), "no_match" (nothing resolved for the location), "nothing_to_search" (company has no name or location), or "lookup_failed" (the geocoder could not be reached). Rate-limited to 1 req/sec.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Struct({
		outcome: Schema.Literals([
			'geocoded',
			'no_match',
			'nothing_to_search',
			'lookup_failed',
		]),
		company: Schema.NullOr(Company.json),
	}),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Geocode Company')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, true)

export const CompanyTools = Toolkit.make(
	SearchCompanies,
	GetCompany,
	CreateCompanies,
	UpdateCompany,
	GeocodeCompany,
)

export const CompanyHandlersLive = CompanyTools.toLayer(
	Effect.gen(function* () {
		const service = yield* CompanyService
		const geocoder = yield* Geocoder
		// The re-geocode fork re-enters org scope on its own connection, so it
		// needs the SqlClient; resolve it here and provide it to the update
		// path, keeping CurrentOrg as the only request service.
		const sql = yield* SqlClient.SqlClient
		const timeline = yield* TimelineActivityService
		return {
			search_companies: params =>
				Effect.gen(function* () {
					const companies = yield* service.search({
						status: params.status,
						country: params.country,
						industry: params.industry,
						priority: params.priority,
						productFit: params.product_fit,
						fitVerdict: params.fit_verdict,
						fitCriterionPassed: params.fit_criterion_passed,
						query: params.query,
						minLat: params.min_lat,
						maxLat: params.max_lat,
						minLng: params.min_lng,
						maxLng: params.max_lng,
						limit: params.limit,
					})
					return toItems(companies.items)
				}).pipe(Effect.orDie),
			get_company: ({ id_or_slug }) =>
				service.getWithRelations(id_or_slug).pipe(
					Effect.catchTag('NotFound', () => service.findById(id_or_slug)),
					Effect.orDie,
				),
			create_companies: params =>
				Effect.gen(function* () {
					const created = yield* service.createMany(params.companies)
					const landed = new Set(created.map(company => company.slug))
					const skipped_slugs = skippedCreateSlugs(
						params.companies.map(company => company.slug),
						landed,
					)
					return { created, skipped_slugs }
				}).pipe(Effect.orDie),
			update_company: ({ id, ...fields }) =>
				Effect.gen(function* () {
					// Capture the stage before the write so an agent-driven change
					// is recorded on the timeline too (actor unknown → null).
					const before =
						fields.status === undefined
							? null
							: yield* service.findById(id).pipe(
									Effect.map(row =>
										typeof row['status'] === 'string' ? row['status'] : null,
									),
									Effect.catch(() => Effect.succeed(null)),
								)
					const actor = yield* CurrentUser
					// Only a person takes ownership of the notes. An agent may write them,
					// but leaves the marker alone, so it can never make its own text look
					// like a person's and freeze out later research.
					const payload = withBriefOwnership(fields, actor)
					const result = yield* updateCompanyRegeocoding(id, payload).pipe(
						Effect.provideService(CompanyService, service),
						Effect.provideService(Geocoder, geocoder),
						Effect.provideService(SqlClient.SqlClient, sql),
					)
					yield* recordStageChange({
						companyId: id,
						from: before,
						to: fields.status,
						actorUserId: null,
					}).pipe(Effect.provideService(TimelineActivityService, timeline))
					return result
				}).pipe(Effect.orDie),
			geocode_company: ({ id }) =>
				geocodeCompany(id).pipe(
					Effect.provideService(CompanyService, service),
					Effect.provideService(Geocoder, geocoder),
					Effect.map(result => ({
						outcome: result._tag,
						company: result._tag === 'geocoded' ? result.company : null,
					})),
					Effect.orDie,
				),
		}
	}),
)
