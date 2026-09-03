import { Schema, SchemaGetter } from 'effect'
import { Model } from 'effect/unstable/schema'

import { DbNumberOrNull } from './_common'
import {
	EMAIL_ADDRESS_PATTERN,
	INSTAGRAM_ADDRESS_PATTERN,
	LINKEDIN_ADDRESS_PATTERN,
	MAPS_ADDRESS_PATTERN,
	PHONE_ADDRESS_PATTERN,
	WEBSITE_ADDRESS_PATTERN,
} from './channel-address'

export const CompanyId = Schema.String.pipe(Schema.brand('CompanyId'))

// How many people a company employs, in bands. A fixed set because a band only
// means something next to the others — unlike a trade, which each organisation
// names for itself in `company_industries`. Exported as a tuple so both a
// Schema.Literals and a plain-array membership check read from one source.
//
// The bottom is deliberately coarse and the top is not. Splitting a sole trader
// from a five-person workshop rarely changes how either is sold to, and both are
// reached the same way — so they share a band. Above a few thousand people the
// differences are real: who buys, how long it takes, and whether there is a
// procurement department at all are not the same question at eight thousand as at
// two hundred thousand, and an organisation selling up there needs to tell them
// apart.
//
// Every boundary below is one the previous, narrower set also had, so a company
// banded under the old scale lands in exactly one band under this one.
export const COMPANY_SIZE_RANGES = [
	'1-10',
	'11-50',
	'51-200',
	'201-500',
	'501-1000',
	'1001-5000',
	'5001-25000',
	'25001-100000',
	'100001+',
] as const
export const CompanySizeRange = Schema.Literals(COMPANY_SIZE_RANGES)
export type CompanySizeRange = typeof CompanySizeRange.Type

// The stages a company moves through, in the order they are worked. This order is
// the board's column order and the dashboard's lane order, not just a list of
// allowed words — reordering it moves the columns. A stage spelled any other way
// belongs to no column and shows up nowhere, which is why every way in reads from
// here.
export const COMPANY_STATUSES = [
	'prospect',
	'contacted',
	'responded',
	'meeting',
	'proposal',
	'client',
	'closed',
	'dead',
] as const
export const CompanyStatus = Schema.Literals(COMPANY_STATUSES)
export type CompanyStatus = typeof CompanyStatus.Type

// How warm a lead is: 1 hot, 2 medium, 3 cold. Three bands, because these are the
// only ones with a name to show and to filter by.
export const COMPANY_PRIORITIES = [1, 2, 3] as const
export const CompanyPriority = Schema.Literals(COMPANY_PRIORITIES)
export type CompanyPriority = typeof CompanyPriority.Type

// The reasons a company is worth someone's time today: `overdue` missed the
// follow-up date somebody set, `stale` is mid-chase and has not been heard from
// in a while, `no-next-action` has nothing written down as the next step at all.
// The dashboard groups by these and the company list filters by them, so they are
// spelled once here and the rules behind them once in the server's
// company-attention module.
export const ATTENTION_FILTERS = ['overdue', 'stale', 'no-next-action'] as const
export const AttentionFilter = Schema.Literals(ATTENTION_FILTERS)
export type AttentionFilter = typeof AttentionFilter.Type

// The orders a company list can be read in. A closed set, because each word
// stands for one fixed ordering held elsewhere: a word that is not on the list
// would be taken and then ignored, and the caller would be handed priority order
// believing it had asked for something else.
export const COMPANY_SORTS = [
	'priority',
	'name',
	'recent_contact',
	'recent_update',
] as const
export const CompanySort = Schema.Literals(COMPANY_SORTS)
export type CompanySort = typeof CompanySort.Type

// The shape each written-in value has to have. They live beside the vocabularies
// above so every way into a company row checks the same thing, and something that
// could never be a real address or phone number is turned away where it is typed
// rather than stored and puzzled over later.
//
// These belong on what a caller sends, never on the stored row: a row written
// before these existed still has to be readable, or every list of companies fails
// on the first bad value somebody saved months ago.
export const CompanySlug = Schema.String.pipe(
	Schema.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
)

// A label somebody groups companies by. Anything except a comma, because a
// query string has no list of its own and several tags travel as one
// comma-separated value — so a tag holding a comma would be split back into two
// tags nobody carries, and the companies under it would quietly stop being
// findable. Refused where it is typed rather than mangled where it is read.
export const CompanyTag = Schema.String.pipe(
	Schema.check(
		Schema.isMinLength(1),
		Schema.isPattern(/^[^,]+$/),
		// No leading or trailing blanks, and not blank all through. Several tags
		// travel as one comma-separated value and each is trimmed on the way back,
		// so a padded tag is offered in the menu under one spelling and asked for
		// under another, and a blank one asks for nothing at all.
		Schema.isPattern(/^\S(.*\S)?$/s),
	),
)
// Raised to capitals as it comes in, because narrowing by a country and counting
// how many carry it both compare the stored text exactly: a company written `es`
// would be missed by anyone asking for `ES`, and would be offered as a second
// Spain with a count of its own. Only what a caller sends passes through here —
// a row already stored is read as written, by the plain string on the row below.
export const CompanyCountry = Schema.String.pipe(
	Schema.check(Schema.isPattern(/^[A-Za-z]{2}$/)),
	// The same shape on the far side of the raising, not only before it. A check
	// that sits only on the way in leaves the finished type a plain string, and
	// anything asking "is this a country code?" of a finished value — a guard on
	// a paid lookup, most of all — quietly answers yes to every word there is.
	Schema.decodeTo(
		Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Z]{2}$/))),
		{
			decode: SchemaGetter.transform((code: string) => code.toUpperCase()),
			encode: SchemaGetter.transform((code: string) => code),
		},
	),
)

/**
 * The same raising, for a country arriving anywhere a schema does not decode it —
 * a filter value, most of all, which has to compare against what was stored.
 */
export const normalizeCountry = (code: string): string => code.toUpperCase()
// The four ways of reaching a company are the same shapes a person's channels
// use, read from one place — a company's email and a contact's email are the same
// question, and answering it twice is how the two doors start disagreeing.
export const CompanyWebsite = Schema.String.pipe(
	Schema.check(Schema.isPattern(WEBSITE_ADDRESS_PATTERN)),
)
export const CompanyEmail = Schema.String.pipe(
	Schema.check(Schema.isPattern(EMAIL_ADDRESS_PATTERN)),
)
export const CompanyPhone = Schema.String.pipe(
	Schema.check(Schema.isPattern(PHONE_ADDRESS_PATTERN)),
)
export const CompanyInstagram = Schema.String.pipe(
	Schema.check(Schema.isPattern(INSTAGRAM_ADDRESS_PATTERN)),
)
export const CompanyLinkedin = Schema.String.pipe(
	Schema.check(Schema.isPattern(LINKEDIN_ADDRESS_PATTERN)),
)
export const CompanyGoogleMapsUrl = Schema.String.pipe(
	Schema.check(Schema.isPattern(MAPS_ADDRESS_PATTERN)),
)
// A page the company keeps on a platform. A list of kind-and-address pairs
// rather than a field per platform, because which platforms exist is not this
// schema's business to know: the kind is stored as it arrives, the way a channel
// always has been, so a platform nobody has met yet needs no change here. The
// address is only asked to say something, since a kind nothing describes has no
// shape to hold it to.
export const CompanySocialProfile = Schema.Struct({
	kind: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	value: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
})
// Finite rather than a plain number: a plain number also allows the words "NaN"
// and "Infinity", which no place on Earth has, and which reach the database as a
// server error instead of a refused value.
export const CompanyLatitude = Schema.Finite.pipe(
	Schema.check(Schema.isBetween({ minimum: -90, maximum: 90 })),
)
export const CompanyLongitude = Schema.Finite.pipe(
	Schema.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
)

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
	// When this company was taken out of view, or null while it is in use.
	// Carried on the record itself because a company that was deleted still gets
	// read — to show what is about to be restored, and to list the deleted ones
	// so somebody can pick it. Without it those reads look exactly like a live
	// company, and the next write against it fails for no visible reason.
	deletedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	verifiedBy: Schema.NullOr(Schema.String),

	// Classification. `industry` is the web-address form of an entry in the
	// organisation's own list of trades — kept on the row so a filter and a shared
	// link need no join, and written only by the trades service, alongside the
	// entry it points at. That entry's id stays out of here: the readable form is
	// what a caller should hold on to, and the id is storage.
	//
	// Size takes one of COMPANY_SIZE_RANGES. Read back these stay plain strings, so
	// a row holding an older value is still shown rather than failing to load.
	// country is the global geographic segment — an ISO 3166-1 alpha-2 code.
	industry: Schema.NullOr(Schema.String),
	sizeRange: Schema.NullOr(Schema.String),
	country: Schema.NullOr(Schema.String),
	location: Schema.NullOr(Schema.String),
	// Finite for the same reason DbNumber is: a plain number publishes "NaN" and
	// "Infinity" beside it, which becomes a choice inside a choice here.
	priority: Schema.NullOr(Schema.Finite),
	// values: COMPANY_PRIORITIES — 1 (hot) | 2 (medium) | 3 (cold)

	// How to reach the company lives in `channels`, keyed to the company the same
	// way a person's is keyed to them — so a chain can hold one mailbox per shop
	// and a firm one per office, each labelled. "The company's email" is the
	// primary email channel, which is one answer today and can be several
	// tomorrow.
	//
	// The map link stays here: it points at a place, not at anybody, and belongs
	// with the coordinates beside it.
	googleMapsUrl: Schema.NullOr(Schema.String),

	// Sales intel
	productsFit: Schema.NullOr(Schema.Array(Schema.String)),
	tags: Schema.NullOr(Schema.Array(Schema.String)),
	painPoints: Schema.NullOr(Schema.String),
	currentTools: Schema.NullOr(Schema.String),

	// What research found out about this company, and where it came from.
	//
	// accountBrief is the running written summary of the account, in markdown.
	// A write replaces the whole text, and nothing keeps the earlier versions or
	// who wrote them. Who else writes it, and when, is in docs/architecture.md.
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
	// These three are the research engine's own: a run writes them when its
	// findings are applied, and no tool a person or an assistant can call sets
	// them. That is deliberate — the field answers "what did the run conclude",
	// and letting anything else write it would leave nobody able to tell a run's
	// reading from somebody's disagreement with it. A view of your own about
	// whether a company is worth selling to belongs under `metadata`, by
	// convention as `fitVerdict` there, which search_companies can filter on with
	// its metadata_key / metadata_value pair.
	//
	// The fit checks and conflicts are kept word for word as the research run
	// wrote them, so their inner names are the ones the research schema defines.
	// The provenance map is built entry by entry instead, so it carries this
	// app's own names.
	accountBrief: Schema.NullOr(Schema.String),
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
	latitude: DbNumberOrNull,
	longitude: DbNumberOrNull,
	geocodedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	geocodeSource: Schema.NullOr(Schema.String),

	// Catch-all for evolving data
	metadata: Schema.NullOr(Schema.Unknown),

	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}
