import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const CompanyId = Schema.String.pipe(Schema.brand('CompanyId'))

export class Company extends Model.Class<Company>('Company')({
	id: Model.Generated(CompanyId),
	slug: Schema.String,
	name: Schema.String,

	// Pipeline
	status: Schema.String,
	// values: prospect | contacted | responded | meeting
	//         | proposal | client | closed | dead

	// Classification
	industry: Schema.NullOr(Schema.String),
	// values: restauració | construcció | retail | manufactura
	//         | serveis | hostaleria | distribució | transport | other
	sizeRange: Schema.NullOr(Schema.String),
	// values: 1-5 | 6-10 | 11-25 | 26-50 | 51-200
	region: Schema.NullOr(Schema.String),
	// values: cat | ara | cv
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
