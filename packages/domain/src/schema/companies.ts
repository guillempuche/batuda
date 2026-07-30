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
	'201-500',
	'501-1000',
	'1001-5000',
	'5001+',
] as const
export const CompanySizeRange = Schema.Literals(COMPANY_SIZE_RANGES)
export type CompanySizeRange = typeof CompanySizeRange.Type

export class Company extends Model.Class<Company>('Company')({
	id: Model.GeneratedByDb(CompanyId),
	slug: Schema.String,
	name: Schema.String,

	// The number the company is registered under — a Spanish NIF/CIF, a UK company
	// number, a VAT number. The one name for a company that is the same the world
	// over and does not change, which makes it the surest way to tell two
	// similarly-named companies apart. Free text, because every country writes it
	// differently and a person typing one in should never be refused for it.
	taxId: Schema.NullOr(Schema.String),

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

	// What research found out about this company, and where it came from.
	//
	// accountBrief is the running written summary of the account, in markdown.
	// Both a person and the research pipeline write it, so briefUpdatedBy holds
	// the id of the person who last edited it — null while nobody has, which is
	// what makes it safe to replace wholesale. Once it is set, research is added
	// to the end instead of overwriting what the person wrote.
	//
	// fieldProvenance answers "where did this come from?" for the individual
	// facts on the row: for each field name, the page it was read from, the run
	// that read it, how sure that run was, and the date it was true as of.
	//
	// lastEnrichedAt is when research findings were last accepted onto this row.
	//
	// The fit fields hold whether this company is worth selling to: an overall
	// verdict, the per-criterion checks behind it, and the points where two
	// sources disagreed. Leaf values stay free text for the same reason industry
	// and size do — the research guards are the enforcement point, so a stored
	// value the vocabulary does not know is shown, never decode-rejected.
	// fitVerdict values: strong_fit | possible_fit | weak_fit | no_fit
	// fitChecks[].result values: pass | fail | unknown
	//
	// The fit checks and conflicts are kept word for word as the research run
	// wrote them, so their inner names are the ones the research schema defines.
	// The provenance map is built entry by entry instead, so it carries this
	// app's own names.
	accountBrief: Schema.NullOr(Schema.String),
	briefUpdatedBy: Schema.NullOr(Schema.String),
	briefUpdatedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	lastEnrichedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	fieldProvenance: Schema.NullOr(
		Schema.Record(
			Schema.String,
			Schema.Struct({
				sourceUrl: Schema.String,
				runId: Schema.String,
				confidence: Schema.optionalKey(Schema.Number),
				asOf: Schema.optionalKey(Schema.String),
			}),
		),
	),
	fitVerdict: Schema.NullOr(Schema.String),
	fitChecks: Schema.NullOr(
		Schema.Array(
			Schema.Struct({
				criterion: Schema.String,
				result: Schema.String,
				evidence_quote: Schema.optionalKey(Schema.String),
				source_id: Schema.optionalKey(Schema.String),
			}),
		),
	),
	fitConflicts: Schema.NullOr(
		Schema.Array(
			Schema.Struct({
				field: Schema.String,
				value: Schema.String,
				source_id: Schema.optionalKey(Schema.String),
				note: Schema.optionalKey(Schema.String),
			}),
		),
	),
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
