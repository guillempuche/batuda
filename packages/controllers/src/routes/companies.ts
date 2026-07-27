import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { Company, Contact, Interaction } from '@batuda/domain'

import { NotFound } from '../errors'
import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'
import { PaginatedList, pageQuery } from '../pagination'

// One research run whose findings were applied to a company, with the pages its
// citations point at — so a reader can trace a fact on the row back to the run
// and the page it came from.
export const CompanyResearchRun = Schema.Struct({
	runId: Schema.String,
	runCompletedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	sources: Schema.Array(
		Schema.Struct({ sourceId: Schema.String, url: Schema.String }),
	),
})

// Company detail: the company plus its contacts (each with the `channels` JSON
// array the client parses) and recent interactions.
export const CompanyDetail = Schema.Struct({
	...Company.json.fields,
	contacts: Schema.Array(
		Schema.Struct({
			...Contact.json.fields,
			channels: Schema.Array(Schema.Unknown),
		}),
	),
	recentInteractions: Schema.Array(Interaction.json),
	researchRuns: Schema.Array(CompanyResearchRun),
})

const CreateCompanyInput = Schema.Struct({
	name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	slug: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9-]+$/))),
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
	nextActionAt: Schema.optional(Schema.DateTimeUtc),
	latitude: Schema.optional(Schema.Number),
	longitude: Schema.optional(Schema.Number),
	geocodedAt: Schema.optional(Schema.DateTimeUtc),
	geocodeSource: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
})

const UpdateCompanyInput = Schema.Struct({
	// The account's running notes, in markdown. A person editing them takes
	// ownership of them, which is what stops later research replacing their text.
	accountBrief: Schema.optional(Schema.String),
	name: Schema.optional(Schema.String),
	// null clears the owner (release a lead); omitting leaves it unchanged.
	ownerId: Schema.optional(Schema.NullOr(Schema.String)),
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
	nextActionAt: Schema.optional(Schema.DateTimeUtc),
	latitude: Schema.optional(Schema.Number),
	longitude: Schema.optional(Schema.Number),
	geocodedAt: Schema.optional(Schema.DateTimeUtc),
	geocodeSource: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
})

export const CompaniesGroup = HttpApiGroup.make('companies')
	.add(
		HttpApiEndpoint.get('list', '/companies', {
			query: {
				status: Schema.optional(Schema.String),
				country: Schema.optional(Schema.String),
				industry: Schema.optional(Schema.String),
				priority: Schema.optional(Schema.NumberFromString),
				owner: Schema.optional(Schema.String),
				fitVerdict: Schema.optional(Schema.String),
				fitCriterionPassed: Schema.optional(Schema.String),
				sort: Schema.optional(Schema.String),
				query: Schema.optional(Schema.String),
				minLat: Schema.optional(Schema.NumberFromString),
				maxLat: Schema.optional(Schema.NumberFromString),
				minLng: Schema.optional(Schema.NumberFromString),
				maxLng: Schema.optional(Schema.NumberFromString),
				...pageQuery,
			},
			success: PaginatedList(Company.json),
		}),
	)
	.add(
		HttpApiEndpoint.get('get', '/companies/:slug', {
			params: { slug: Schema.String },
			success: CompanyDetail,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/companies', {
			payload: CreateCompanyInput,
			success: Company.json,
		}),
	)
	.add(
		HttpApiEndpoint.patch('update', '/companies/:id', {
			params: { id: Schema.String },
			payload: UpdateCompanyInput,
			// null when the id doesn't exist.
			success: Schema.NullOr(Company.json),
		}),
	)
	.add(
		HttpApiEndpoint.post('geocode', '/companies/:id/geocode', {
			params: { id: Schema.String },
			success: Company.json,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		// Mark a company as a verified lead (or clear it). `verified: true` stamps
		// who verified it and when; `false` clears both.
		HttpApiEndpoint.post('verify', '/companies/:id/verify', {
			params: { id: Schema.String },
			payload: Schema.Struct({ verified: Schema.Boolean }),
			success: Company.json,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')
