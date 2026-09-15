import { Schema } from 'effect'

import { foldLabel } from '../text-fold'

// The facts a campaign records on every company, declared by the organisation
// rather than shipped with the app.
//
// A declaration has a key (what a value is stored under), a label (what people
// see) and a kind. The kinds are a closed set because each one decides how a
// value is checked and which filters make sense for it: a number can be "at
// least 3", a date "before June", a choice "one of these words". Nothing here
// names a particular attribute — an organisation selling to freight brokers
// declares "loads per day", one selling to machine shops "quotes per week".
//
// Every rule about a declaration or a value is written here, in TypeScript, and
// read by every caller, so each refuses the same things for the same reasons.
// The database keeps a unique index as a race guard and nothing else of the
// rules.

export const ATTRIBUTE_KINDS = [
	'text',
	'number',
	'enum',
	'boolean',
	'date',
] as const
export const AttributeKind = Schema.Literals(ATTRIBUTE_KINDS)
export type AttributeKind = typeof AttributeKind.Type

// A key is a slug: lowercase letters, digits and underscores, starting with a
// letter. It is what a value is filed under on the company, so it never changes
// once created.
export const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/

// Names a key may not take. A research run stores its attribute values under the
// key beside the run's own fields, and several of its checks act on a field by
// its name — so a key spelled like one of those fields would be mistaken for it.
// The last three reach an object's prototype in JavaScript.
export const ATTRIBUTE_RESERVED_KEYS: ReadonlySet<string> = new Set([
	// Every field name a research run's findings use, top level or nested —
	// what a run fills on a company profile, a scan row, a contact, a
	// competitor, a proposed change. A test in the research package holds this
	// list to the schemas, so a field added there has to be added here.
	'args',
	'as_of',
	'attributes',
	'buying_role',
	'channels',
	'citations',
	'competitors',
	'confidence',
	'conflicts',
	'contacts',
	'countries',
	'country',
	'criterion',
	'description',
	'discovered_existing',
	'disqualifiers',
	'email',
	'employee_estimate',
	'enrichment',
	'estimated_cents',
	'evidence',
	'evidence_quote',
	'expected_version',
	'field',
	'fields',
	'fit_checks',
	'id',
	'industry',
	'is_primary',
	'key',
	'key_differentiators',
	'kind',
	'location',
	'market_maturity',
	'market_summary',
	'marks',
	'name',
	'note',
	'operation',
	'overlap',
	'pending_paid_actions',
	'phone',
	'proposed_updates',
	'prospects',
	'quote',
	'reason',
	'result',
	'role',
	'rule',
	'size_range',
	'social_profiles',
	'source_id',
	'status',
	'strengths',
	'subject_id',
	'subject_table',
	'tags',
	'tax_id',
	'tool',
	'total_competitors_found',
	'unconfirmed_reason',
	'value',
	'verdict',
	'verdict_rationale',
	'verification',
	'version',
	'weaknesses',
	'website',
	'whatsapp',
	'why',
	'why_relevant',
	// Reach the prototype rather than a property when used as an object key.
	'__proto__',
	'constructor',
	'prototype',
])

// How a list can be narrowed by an attribute, per kind. A number is compared as
// a number and a date as a date, so "at least" and "at most" mean something
// there and nowhere else; a word from a list is one of several or exactly one.
export const ATTRIBUTE_OPS = ['eq', 'in', 'gte', 'lte', 'contains'] as const
export const AttributeOp = Schema.Literals(ATTRIBUTE_OPS)
export type AttributeOp = typeof AttributeOp.Type

export const OPS_FOR_KIND: Record<AttributeKind, ReadonlyArray<AttributeOp>> = {
	text: ['eq', 'in', 'contains'],
	enum: ['eq', 'in'],
	boolean: ['eq'],
	number: ['eq', 'gte', 'lte'],
	date: ['eq', 'gte', 'lte'],
}

// Sizes. The label, unit and choice words reach a research run's prompts, so
// they are kept short enough to be names rather than sentences: the admin who
// declares them is trusted, but a prompt is not the place for a paragraph.
export const ATTRIBUTE_LABEL_MAX = 40
export const ATTRIBUTE_UNIT_MAX = 16
export const ATTRIBUTE_ENUM_VALUE_MAX = 32
export const ATTRIBUTE_DESCRIPTION_MAX = 500
export const ATTRIBUTE_TEXT_MAX = 2000
export const ATTRIBUTES_PER_STACK_MAX = 8
// The notes beside a value: a quote is cut to this, a page address longer than
// this is not one.
export const ATTRIBUTE_QUOTE_MAX = 500
export const ATTRIBUTE_SOURCE_MAX = 2048

// A stored value: text, a number, or yes/no. A date is stored as its text.
export const AttributeValue = Schema.Union([
	Schema.String,
	Schema.Finite,
	Schema.Boolean,
])
export type AttributeValue = typeof AttributeValue.Type

// What a caller sends for one key: the bare value, the value with the page and
// quote it was read from, or null to remove the key. One flat choice: an
// optional wrapped around a nullable would nest one choice inside another, which
// some model providers refuse outright.
export const AttributeValueInput = Schema.Union([
	Schema.String,
	Schema.Finite,
	Schema.Boolean,
	Schema.Struct({
		value: AttributeValue,
		source_id: Schema.optionalKey(Schema.String),
		quote: Schema.optionalKey(Schema.String),
		as_of: Schema.optionalKey(Schema.String),
	}),
	Schema.Null,
])
export type AttributeValueInput = typeof AttributeValueInput.Type

// The keys are not judged here: a check on a record's key schema only selects
// the keys that match, it never refuses one, and a key that could never be
// declared is refused by the write rules as undeclared, which names it.
export const CompanyAttributesInput = Schema.Record(
	Schema.String,
	AttributeValueInput,
)
export type CompanyAttributesInput = typeof CompanyAttributesInput.Type

// Who wrote a value: a person or an assistant through the ordinary tools, or a
// research run. Always stamped by the server, never taken from a caller.
const ATTRIBUTE_SETTERS = ['client', 'research'] as const
const AttributeSetter = Schema.Literals(ATTRIBUTE_SETTERS)

// One stored value, as it sits under its key on the company. The page it was
// read from is kept by its address — what a reader can open — never by the id
// a research run gave it, which means nothing outside that run.
export const AttributeValueEntry = Schema.Struct({
	value: AttributeValue,
	source_url: Schema.optionalKey(Schema.String),
	quote: Schema.optionalKey(Schema.String),
	as_of: Schema.optionalKey(Schema.String),
	research_id: Schema.optionalKey(Schema.String),
	set_by: AttributeSetter,
})
export type AttributeValueEntry = typeof AttributeValueEntry.Type

// What a research run is handed for each attribute its stack declares: enough to
// ask for it and to check what comes back, without the bookkeeping.
export const ResearchAttributeDeclaration = Schema.Struct({
	key: Schema.String,
	label: Schema.String,
	kind: AttributeKind,
	enumValues: Schema.NullOr(Schema.Array(Schema.String)),
	unit: Schema.NullOr(Schema.String),
	description: Schema.NullOr(Schema.String),
})
export type ResearchAttributeDeclaration =
	typeof ResearchAttributeDeclaration.Type

const NUMBER_TEXT = /^-?\d+(\.\d+)?$/
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/

// Whether a YYYY-MM-DD text names a day that exists: "2024-02-30" has the
// shape and is not a day.
export const isCalendarDay = (text: string): boolean => {
	if (!DATE_TEXT.test(text)) return false
	const [year, month, day] = text.split('-').map(Number) as [
		number,
		number,
		number,
	]
	// Set the year apart from the rest: handed a year below one hundred,
	// Date.UTC reads it as the nineteen hundreds.
	const date = new Date(0)
	date.setUTCFullYear(year, month - 1, day)
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	)
}

// A raw value read as its declared kind, or null when it cannot be.
//
// Forgiving where the meaning is not in doubt — a number written as text, a
// yes/no written as "yes", a choice word in another case or without its
// accents — and strict everywhere else, so what is stored always has the shape
// its kind promises and a filter can compare it without looking first.
export const coerceAttributeValue = (
	kind: AttributeKind,
	raw: unknown,
	enumValues: ReadonlyArray<string> | null,
): AttributeValue | null => {
	switch (kind) {
		case 'number': {
			if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
			if (typeof raw !== 'string') return null
			// Spaces anywhere are dropped, so a number grouped the European way
			// ("1 200") reads as one number.
			const text = raw.replace(/\s+/g, '')
			if (!NUMBER_TEXT.test(text)) return null
			const parsed = Number(text)
			return Number.isFinite(parsed) ? parsed : null
		}
		case 'boolean': {
			if (typeof raw === 'boolean') return raw
			if (typeof raw !== 'string') return null
			const word = raw.trim().toLowerCase()
			if (word === 'true' || word === 'yes') return true
			if (word === 'false' || word === 'no') return false
			return null
		}
		case 'date': {
			if (typeof raw !== 'string') return null
			const text = raw.trim()
			return isCalendarDay(text) ? text : null
		}
		case 'enum': {
			if (typeof raw !== 'string' || enumValues === null) return null
			const wanted = foldLabel(raw)
			if (wanted === '') return null
			// Stored in the declaration's own spelling, so every company reads the
			// same word back whatever case or accents the caller sent.
			return enumValues.find(option => foldLabel(option) === wanted) ?? null
		}
		case 'text': {
			if (typeof raw !== 'string') return null
			const text = raw.trim()
			return text !== '' && text.length <= ATTRIBUTE_TEXT_MAX ? text : null
		}
		// A kind the code does not know — a row written by hand — reads as
		// nothing rather than as a value with no rule.
		default:
			return null
	}
}
