import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { Conflict, NotFound } from '../errors'
import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'

// One trade in an organisation's own list.
//
// The folded form stays on the server. It is how two spellings are recognised as
// one trade, and showing it would invite somebody to treat it as the name.
//
// `companyCount` includes companies in the bin, because they are what stops a
// trade being removed — a count that left them out would offer a Remove that
// always fails.
export const CompanyIndustryView = Schema.Struct({
	id: Schema.String,
	label: Schema.String,
	slug: Schema.String,
	needsReview: Schema.Boolean,
	companyCount: Schema.Number,
})

export const RenameCompanyIndustryInput = Schema.Struct({
	label: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
})

export const MergeCompanyIndustryInput = Schema.Struct({
	/** The trade that survives; the one in the path is folded into it. */
	intoId: Schema.String,
})

export const MergedCompanyIndustryView = Schema.Struct({
	moved: Schema.Number,
})

// The trades an organisation sells to, and the ways of tidying that list.
//
// There is no create: a trade comes into being by being written onto a company,
// so one added here would be a name with nothing on it. Every member may curate
// the list, the same as they may edit any company — this is CRM data, not a
// setting that changes what other people can do.
export const CompanyIndustriesGroup = HttpApiGroup.make('companyIndustries')
	.add(
		HttpApiEndpoint.get('list', '/company-industries', {
			success: Schema.Array(CompanyIndustryView),
		}),
	)
	.add(
		// Renaming also accepts the name: choosing the wording is the review.
		HttpApiEndpoint.patch('rename', '/company-industries/:id', {
			params: { id: Schema.String },
			payload: RenameCompanyIndustryInput,
			success: Schema.Void,
			error: Schema.Union([
				NotFound.pipe(HttpApiSchema.status(404)),
				Conflict.pipe(HttpApiSchema.status(409)),
			]),
		}),
	)
	.add(
		HttpApiEndpoint.post('review', '/company-industries/:id/review', {
			params: { id: Schema.String },
			success: Schema.Void,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('merge', '/company-industries/:id/merge', {
			params: { id: Schema.String },
			payload: MergeCompanyIndustryInput,
			success: MergedCompanyIndustryView,
			error: Schema.Union([
				NotFound.pipe(HttpApiSchema.status(404)),
				Conflict.pipe(HttpApiSchema.status(409)),
			]),
		}),
	)
	.add(
		HttpApiEndpoint.delete('delete', '/company-industries/:id', {
			params: { id: Schema.String },
			success: Schema.Void,
			error: Schema.Union([
				NotFound.pipe(HttpApiSchema.status(404)),
				Conflict.pipe(HttpApiSchema.status(409)),
			]),
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')
