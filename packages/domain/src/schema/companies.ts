import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const CompanyId = Schema.String.pipe(Schema.brand('CompanyId'))

// The CRM's fixed vocabularies for a company's classification. The columns stay
// free text in the database; these are the allowed values the research pipeline
// maps to and the UI offers. Exported as tuples so both a Schema.Literals and a
// plain-array membership check read from one source.
export const COMPANY_INDUSTRIES = [
	'restauració',
	'construcció',
	'retail',
	'manufactura',
	'serveis',
	'hostaleria',
	'distribució',
	'transport',
	'other',
] as const
export const CompanyIndustry = Schema.Literals(COMPANY_INDUSTRIES)
export type CompanyIndustry = typeof CompanyIndustry.Type

export const COMPANY_REGIONS = ['cat', 'ara', 'cv'] as const
export const CompanyRegion = Schema.Literals(COMPANY_REGIONS)
export type CompanyRegion = typeof CompanyRegion.Type

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
	id: Model.Generated(CompanyId),
	slug: Schema.String,
	name: Schema.String,

	// Pipeline
	status: Schema.String,
	// values: prospect | contacted | responded | meeting
	//         | proposal | client | closed | dead

	// The org member who owns this lead (a Better Auth user id), or null when
	// nobody has claimed it. Powers the "my leads" view.
	ownerId: Schema.NullOr(Schema.String),

	// Classification. Allowed values are COMPANY_INDUSTRIES / COMPANY_SIZE_RANGES /
	// COMPANY_REGIONS above; the columns stay free text (the research vocabulary
	// guard is the enforcement point) so a manual edit is never decode-rejected.
	industry: Schema.NullOr(Schema.String),
	sizeRange: Schema.NullOr(Schema.String),
	region: Schema.NullOr(Schema.String),
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
	latitude: Schema.NullOr(Schema.Number),
	longitude: Schema.NullOr(Schema.Number),
	geocodedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	geocodeSource: Schema.NullOr(Schema.String),

	// Catch-all for evolving data
	metadata: Schema.NullOr(Schema.Unknown),

	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}
