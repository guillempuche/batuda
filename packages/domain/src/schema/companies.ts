import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

import { DbNumber } from './_common'

export const CompanyId = Schema.String.pipe(Schema.brand('CompanyId'))

// The CRM's fixed vocabularies for a company's classification. The columns stay
// free text in the database; these are the allowed values the research pipeline
// maps to and the UI offers. Exported as tuples so both a Schema.Literals and a
// plain-array membership check read from one source.
export const COMPANY_INDUSTRIES = [
	'restaurants',
	'construction',
	'retail',
	'manufacturing',
	'services',
	'hospitality',
	'distribution',
	'transport',
	'other',
] as const
export const CompanyIndustry = Schema.Literals(COMPANY_INDUSTRIES)
export type CompanyIndustry = typeof CompanyIndustry.Type

export const COMPANY_SIZE_RANGES = [
	'1-5',
	'6-10',
	'11-25',
	'26-50',
	'51-200',
] as const
export const CompanySizeRange = Schema.Literals(COMPANY_SIZE_RANGES)
export type CompanySizeRange = typeof CompanySizeRange.Type

export class Company extends Model.Class<Company>('Company')({
	id: Model.GeneratedByDb(CompanyId),
	slug: Schema.String,
	name: Schema.String,

	// Pipeline
	status: Schema.String,
	// values: prospect | contacted | responded | meeting
	//         | proposal | client | closed | dead

	// The org member who owns this lead (a Better Auth user id), or null when
	// nobody has claimed it. Powers the "my leads" view.
	ownerId: Schema.NullOr(Schema.String),

	// When a human confirmed this is a real lead worth working, and who did (a
	// Better Auth user id). Null until verified. Independent of the pipeline
	// stage — a company can be verified at any status, and a research-discovered
	// one stays unverified until someone vouches for it.
	verifiedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	verifiedBy: Schema.NullOr(Schema.String),

	// Classification. Allowed values for industry / size are COMPANY_INDUSTRIES /
	// COMPANY_SIZE_RANGES above; the columns stay free text (the research vocabulary
	// guard is the enforcement point) so a manual edit is never decode-rejected.
	// country is the global geographic segment — an ISO 3166-1 alpha-2 code.
	industry: Schema.NullOr(Schema.String),
	sizeRange: Schema.NullOr(Schema.String),
	country: Schema.NullOr(Schema.String),
	location: Schema.NullOr(Schema.String),
	source: Schema.NullOr(Schema.String),
	// values: firecrawl | exa | google_maps | referral
	//         | linkedin | instagram | manual
	priority: Schema.NullOr(Schema.Number),
	// values: 1 (hot) | 2 (medium) | 3 (cold)

	// Contact info
	website: Schema.NullOr(Schema.String),
	email: Schema.NullOr(Schema.String),
	phone: Schema.NullOr(Schema.String),
	instagram: Schema.NullOr(Schema.String),
	linkedin: Schema.NullOr(Schema.String),
	googleMapsUrl: Schema.NullOr(Schema.String),

	// Sales intel
	productsFit: Schema.NullOr(Schema.Array(Schema.String)),
	tags: Schema.NullOr(Schema.Array(Schema.String)),
	painPoints: Schema.NullOr(Schema.String),
	currentTools: Schema.NullOr(Schema.String),

	// Next action
	nextAction: Schema.NullOr(Schema.String),
	nextActionAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	lastContactedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),

	lastEmailAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	lastCallAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	lastMeetingAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	nextCalendarEventAt: Schema.NullOr(Schema.DateTimeUtcFromDate),

	// Geocoded place (optional — populated via Nominatim or seed)
	latitude: Schema.NullOr(DbNumber),
	longitude: Schema.NullOr(DbNumber),
	geocodedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	geocodeSource: Schema.NullOr(Schema.String),

	// Catch-all for evolving data
	metadata: Schema.NullOr(Schema.Unknown),

	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}
