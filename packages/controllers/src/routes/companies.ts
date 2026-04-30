import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { NotFound } from '../errors'
import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'

const CreateCompanyInput = Schema.Struct({
	name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	slug: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9-]+$/))),
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
	nextActionAt: Schema.optional(Schema.DateTimeUtc),
	latitude: Schema.optional(Schema.Number),
	longitude: Schema.optional(Schema.Number),
	geocodedAt: Schema.optional(Schema.DateTimeUtc),
	geocodeSource: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
})

const UpdateCompanyInput = Schema.Struct({
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
				region: Schema.optional(Schema.String),
				industry: Schema.optional(Schema.String),
				priority: Schema.optional(Schema.NumberFromString),
				query: Schema.optional(Schema.String),
				limit: Schema.optional(Schema.NumberFromString),
				offset: Schema.optional(Schema.NumberFromString),
			},
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.get('get', '/companies/:slug', {
			params: { slug: Schema.String },
			success: Schema.Unknown,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/companies', {
			payload: CreateCompanyInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.patch('update', '/companies/:id', {
			params: { id: Schema.String },
			payload: UpdateCompanyInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.post('geocode', '/companies/:id/geocode', {
			params: { id: Schema.String },
			success: Schema.Unknown,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')
