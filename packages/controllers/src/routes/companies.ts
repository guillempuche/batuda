import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import {
	ATTENTION_FILTERS,
	Company,
	CompanyCountry,
	CompanyEmail,
	CompanyGoogleMapsUrl,
	CompanyInstagram,
	CompanyLatitude,
	CompanyLinkedin,
	CompanyLongitude,
	CompanyPhone,
	CompanyPriority,
	CompanySizeRange,
	CompanySlug,
	CompanyStatus,
	CompanyWebsite,
	Contact,
	Interaction,
} from '@batuda/domain'

import { NotFound } from '../errors'
import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'
import { PaginatedList, pageQuery } from '../pagination'
import { StaleDays } from './pipeline'

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

// Company detail: the company plus its own ways of being reached, its contacts
// (each with the `channels` JSON array the client parses) and recent
// interactions.
export const CompanyDetail = Schema.Struct({
	...Company.json.fields,
	// The company's own mailboxes, numbers and handles. Several of each are
	// possible — a chain's shops, a firm's sales and support offices — so the one
	// to show is the primary of its kind rather than "the" email.
	channels: Schema.Array(Schema.Unknown),
	// The places the company trades from. A company with one place needs none of
	// these — its own coordinates say where it is — so this is empty for most.
	sites: Schema.Array(Schema.Unknown),
	// Companies this one belongs with — a parent, a franchisor, whoever bought
	// it — seen from both ends, so opening either company shows the pairing.
	relations: Schema.Array(Schema.Unknown),
	contacts: Schema.Array(
		Schema.Struct({
			...Contact.json.fields,
			channels: Schema.Array(Schema.Unknown),
		}),
	),
	recentInteractions: Schema.Array(Interaction.json),
	researchRuns: Schema.Array(CompanyResearchRun),
})

// What a caller may write. The shapes come from the domain so the browser, the
// agent tools and the research apply path all turn away the same values — and
// they sit here rather than on `Company`, which has to keep reading rows written
// before any of this existed.
export const CreateCompanyInput = Schema.Struct({
	name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	slug: CompanySlug,
	status: Schema.optional(CompanyStatus),
	industry: Schema.optional(Schema.String),
	sizeRange: Schema.optional(CompanySizeRange),
	country: Schema.optional(CompanyCountry),
	location: Schema.optional(Schema.String),
	priority: Schema.optional(CompanyPriority),
	website: Schema.optional(CompanyWebsite),
	email: Schema.optional(CompanyEmail),
	phone: Schema.optional(CompanyPhone),
	instagram: Schema.optional(CompanyInstagram),
	linkedin: Schema.optional(CompanyLinkedin),
	googleMapsUrl: Schema.optional(CompanyGoogleMapsUrl),
	productsFit: Schema.optional(Schema.Array(Schema.String)),
	tags: Schema.optional(Schema.Array(Schema.String)),
	painPoints: Schema.optional(Schema.String),
	currentTools: Schema.optional(Schema.String),
	nextAction: Schema.optional(Schema.String),
	nextActionAt: Schema.optional(Schema.DateTimeUtc),
	latitude: Schema.optional(CompanyLatitude),
	longitude: Schema.optional(CompanyLongitude),
	geocodedAt: Schema.optional(Schema.DateTimeUtc),
	geocodeSource: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
})

// Every field a person can empty from the company page is nullable here. The page
// sends null for a field cleared to blank, so a plain optional refused the write
// and the edit came back as a rejected change with nothing to explain it.
export const UpdateCompanyInput = Schema.Struct({
	// The account's running notes, in markdown. A person editing them takes
	// ownership of them, which is what stops later research replacing their text.
	accountBrief: Schema.optional(Schema.NullOr(Schema.String)),
	name: Schema.optional(
		Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	),
	// null clears the owner (release a lead); omitting leaves it unchanged.
	ownerId: Schema.optional(Schema.NullOr(Schema.String)),
	status: Schema.optional(CompanyStatus),
	industry: Schema.optional(Schema.NullOr(Schema.String)),
	sizeRange: Schema.optional(Schema.NullOr(CompanySizeRange)),
	country: Schema.optional(Schema.NullOr(CompanyCountry)),
	location: Schema.optional(Schema.NullOr(Schema.String)),
	priority: Schema.optional(Schema.NullOr(CompanyPriority)),
	website: Schema.optional(Schema.NullOr(CompanyWebsite)),
	email: Schema.optional(Schema.NullOr(CompanyEmail)),
	phone: Schema.optional(Schema.NullOr(CompanyPhone)),
	instagram: Schema.optional(Schema.NullOr(CompanyInstagram)),
	linkedin: Schema.optional(Schema.NullOr(CompanyLinkedin)),
	googleMapsUrl: Schema.optional(Schema.NullOr(CompanyGoogleMapsUrl)),
	productsFit: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
	tags: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
	painPoints: Schema.optional(Schema.NullOr(Schema.String)),
	currentTools: Schema.optional(Schema.NullOr(Schema.String)),
	nextAction: Schema.optional(Schema.NullOr(Schema.String)),
	nextActionAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
	latitude: Schema.optional(Schema.NullOr(CompanyLatitude)),
	longitude: Schema.optional(Schema.NullOr(CompanyLongitude)),
	geocodedAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
	geocodeSource: Schema.optional(Schema.NullOr(Schema.String)),
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
				// Narrows to what needs doing, in the same words the dashboard uses:
				// `overdue` missed its follow-up date, `stale` is mid-chase and has
				// gone quiet, `no-next-action` has nothing written down at all. The
				// rules are shared with the dashboard's own lists, so a count there
				// opens a list of the same size here.
				attention: Schema.optional(Schema.Literals(ATTENTION_FILTERS)),
				// How long counts as quiet, for `attention=stale`. Rides along on the
				// link so the list matches whatever the dashboard was showing.
				staleDays: Schema.optional(StaleDays),
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
		// The countries this organisation trades with, so the list page can offer
		// every one of them rather than only those on the page being read. Its own
		// path, not `/companies/countries`, which a slug would answer to.
		HttpApiEndpoint.get('countries', '/company-countries', {
			success: Schema.Array(Schema.String),
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
