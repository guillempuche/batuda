/**
 * Holds the per-field `Sourced` scalars (industry, size, location, tools, a
 * contact's role, …) to a "grounded value or nothing" contract.
 *
 * The other guards leave a gap here. The citation guard proves the cited page was
 * fetched; the value guard only checks emails and phone/tax-id digits; the critic
 * is a fail-open model call that keeps a thinly-supported value at low confidence
 * rather than removing it. So a free-text scalar could still ship as a bare value
 * with no real source, as a schema word the model emitted instead of a fact
 * ("headquarters" in the location field), or paired with a quote that does not
 * actually mention it. This guard closes that gap deterministically, before the
 * model-backed critic runs.
 *
 * For each per-field `Sourced` scalar it drops the whole field (to null) when:
 *  - the value is a placeholder or the field's own name, not a real fact;
 *  - the value is the wrong kind of thing for its field — a location that names how
 *    far the company reaches ("15 countries") rather than where it is;
 *  - it carries no fetched source at all — an unsourced fact is treated as absent;
 *  - its quote is largely missing from the gathered evidence (a fabricated quote);
 *  - for a field whose value should read verbatim from the page (location, tools),
 *    the quote shares nothing with the value it claims to back.
 *
 * Email and phone fields are left to the value guard, which checks them against the
 * evidence far more precisely than a text-overlap test could. Citation arrays and
 * the freeform proposed-update blob are skipped so their internal shapes are never
 * mistaken for a scalar field.
 */

import { clipText } from '@batuda/domain'

import { isSourcedField } from './guard-shapes'
import { writtenWithoutWordSpaces } from './term-match'

// Generic non-answers a model emits when it has nothing — never a real value.
const PLACEHOLDER_VALUES = new Set([
	'',
	'-',
	'—',
	'?',
	'n/a',
	'n.a.',
	'na',
	'none',
	'null',
	'nil',
	'undefined',
	'unknown',
	'not available',
	'not found',
	'not specified',
	'not applicable',
	'no data',
	'no information',
	'tbd',
	'value',
	'string',
])

// Stand-in words a model emits in place of a real location — "headquarters" is
// never itself a place. Kept deliberately narrow: a value that merely echoes its
// own field name ("location" in the location field) is caught by the field-name
// check below, and everyday words like "software" or "business" are dropped from
// this set on purpose, since they are legitimate values for the industry or tools
// fields and must not be mistaken for placeholders.
const SCHEMA_WORDS = new Set([
	'headquarters',
	'head office',
	'headquarter',
	'hq',
])

// Fields whose value is meant to read straight off the page (a city name, a tool's
// name), so it should actually appear in the evidence. Coded or paraphrased fields
// (industry, size band, the ISO country code) are deliberately excluded — their
// value is a category, not a span, so a text-overlap test would wrongly reject
// them. A proposed CRM change keys the same fields in camelCase, so the value guard
// can hold those to the page too.
export const PAGE_LITERAL_FIELDS = new Set([
	'location',
	'current_tools',
	'currentTools',
])

// Ways of reaching a person, which the value guard already matches against the
// evidence address-for-address and digit-for-digit — far more precisely than the
// word-overlap test here could — so this guard leaves those alone.
//
// The company's own mailbox and telephone number are a different case, even though
// they are spelled the same way. They are checks this guard alone makes: that the
// field names a page at all, and that the line quoted for it really appears in what
// the run read. So the exemption holds only for a person, and the block a value
// sits in is what tells the two apart.
const CHANNEL_KEYS = new Set(['email', 'phone', 'whatsapp'])

// The company-profile block. A channel field inside it describes the company, so it
// is graded here; the same field name outside it describes a person.
const COMPANY_PROFILE_KEY = 'enrichment'

// Subtrees that are not scalar fields: the block-level citation arrays and the
// freeform proposed-update JSON, whose contents could otherwise look like a field.
const SKIP_KEYS = new Set(['citations', 'proposed_updates'])

// A quote counts as real when at least this share of its distinctive words appear
// in the gathered evidence. Set low so a lightly paraphrased real quote survives
// and only a wholesale-invented one (almost none of its words present) is dropped.
const QUOTE_PRESENCE_THRESHOLD = 0.5

// Accents come off both sides of every comparison here, because the two sides are
// written by different hands: the value is what a model typed and the corpus is what
// a page printed, and "Vallès" on one against "Valles" on the other is one place
// twice. Without this, four of seven real Catalan and Spanish towns failed to find
// themselves on the page that named them, and the field was dropped as unevidenced.
const foldAccents = (value: string): string =>
	value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		// Korean is built from pieces that come apart in the line above, so it is put
		// back together here — otherwise it matches only another copy of itself.
		.normalize('NFC')

const normalize = (value: string): string =>
	foldAccents(value)
		.toLowerCase()
		.trim()
		.replace(/\s+/g, ' ')
		.replace(/[.,;:!?"'`()]+$/g, '')

// The corpus with its accents off, remembered between calls. The whole of what a run
// read is folded here, and every field of every row asks about the same one — so it
// is done once and handed back, rather than once per question.
let lastCorpus = ''
let lastFoldedCorpus = ''
const accentFreeCorpus = (lowerCorpus: string): string => {
	if (lowerCorpus !== lastCorpus) {
		lastCorpus = lowerCorpus
		lastFoldedCorpus = foldAccents(lowerCorpus)
	}
	return lastFoldedCorpus
}

// Below this length a word is a function word rather than a distinctive one, so it
// is dropped: matching on it would create overlaps that mean nothing.
const SALIENT_MIN_CHARS = 4

// A run of characters this long is the unit compared in a writing system with no
// word spaces. Two, because that is roughly what a word is there — asking those for
// a four-letter word asks for a whole phrase, and one character alone appears in far
// too much to say anything.
const SALIENT_RUN_CHARS = 2

// Every run of this length inside a piece of text, so two texts can be compared by
// how much of one appears in the other where neither has words to compare.
const runsOf = (token: string): ReadonlyArray<string> => {
	const letters = [...token]
	if (letters.length < SALIENT_RUN_CHARS) return []
	return letters
		.slice(0, letters.length - SALIENT_RUN_CHARS + 1)
		.map((_, at) => letters.slice(at, at + SALIENT_RUN_CHARS).join(''))
}

// The distinctive parts of a string: long-enough words and multi-digit numbers,
// which carry the meaning (place names, tool names, employee counts) — short
// function words are dropped so they can't create coincidental overlaps.
//
// A word written without word spaces is compared as short runs of characters
// instead. Reading only a-z gave nothing at all for a value written in Chinese,
// Japanese or Thai, and nothing was then given the benefit of the doubt — so an
// invented Chinese address was applied as evidence-backed without a single one of
// its characters being looked for.
const salientTokens = (value: string): ReadonlyArray<string> =>
	normalize(value)
		.split(/[^\p{L}\p{N}]+/u)
		.flatMap(token =>
			writtenWithoutWordSpaces(token)
				? runsOf(token)
				: token.length >= SALIENT_MIN_CHARS || /^\d{2,}$/.test(token)
					? [token]
					: [],
		)

const isPlaceholderValue = (value: string, key: string): boolean => {
	const n = normalize(value)
	if (PLACEHOLDER_VALUES.has(n)) return true
	if (SCHEMA_WORDS.has(n)) return true
	// The value is just the field's own name (`location` → "location").
	return n === normalize(key.replace(/_/g, ' '))
}

// Answers to "where is this company?" that describe how far it reaches, not where
// it is — true of the business, useless as a place. Matched only as the whole
// value, so "Worldwide HQ in Chicago" still keeps its real place.
const REACH_WORDS = new Set([
	'worldwide',
	'global',
	'globally',
	'international',
	'internationally',
	'nationwide',
	'everywhere',
])

// A tally of places dressed up as one — "15 countries throughout the world",
// "operations in 30 cities". A number sitting right before a place word is the tell.
const PLACE_COUNT_RE =
	/\b\d[\d.,]*\s+(?:countr|office|location|site|branch|warehouse|facilit|cit(?:y|ies)|continent|market|region|hub|terminal|depot)/i

// How many places named inside one bracket stop being an address and become the
// list of towns a company covers: "Greater Houston, Texas (Houston, Katy, Sugar
// Land, The Woodlands, Pearland, Pasadena, Spring)" is a service area wearing
// the clothes of a place, and it is how a company in Reno came back filed under
// Houston.
//
// Five, not three, because an address puts real parts in brackets too — a town
// followed by its province, region and country ("Vilanova i la Geltrú
// (Barcelona, Catalunya, Spain)") is the ordinary form across the markets this
// serves, and refusing it would take the place off a company that stated one
// perfectly well.
//
// Counting inside the brackets rather than across the whole value is what keeps
// this off a genuine long address. A comma count over the whole string cannot
// tell "Pol. Ind. Les Comes, C/ Anoia 12, Igualada, Barcelona, Catalunya, Spain"
// from a list of towns, and it also refuses the pipeline's own output: the fold
// that merges a company's branch offices joins them with semicolons, but each
// branch carries its own comma, so five branches written "Town, Province" reach
// any threshold a single address can.
const BRACKETED_PLACES_THAT_MAKE_A_LIST = 5

const commaParts = (value: string): number => value.split(',').length

const listsPlacesInBrackets = (value: string): boolean =>
	[...value.matchAll(/\(([^)]*)\)/g)].some(
		group => commaParts(group[1] ?? '') >= BRACKETED_PLACES_THAT_MAKE_A_LIST,
	)

// A location has to name a place. This rejects the shapes that answer a
// different question — how far the company reaches, how many places it runs, or
// which places it serves — and leaves every real place name alone, however long
// ("Sant Cugat del Vallès, Barcelona, Catalonia, Spain" is fine).
const isPlaceValue = (value: string): boolean =>
	!REACH_WORDS.has(normalize(value)) &&
	!PLACE_COUNT_RE.test(value) &&
	!listsPlacesInBrackets(value)

// Fields whose value must be a particular kind of thing, beyond simply "not a
// placeholder". A location is the clear case; other fields impose no such shape.
const FIELD_RULES: Record<string, (value: string) => boolean> = {
	location: isPlaceValue,
}

// Whether a value is an acceptable kind of thing for its field. A field with no
// rule accepts anything (its other checks still apply).
export const valueIsRightKind = (key: string, value: string): boolean => {
	const rule = FIELD_RULES[key]
	return rule === undefined || rule(value)
}

// The quote backs the value when it contains it outright or shares one of its
// distinctive words. A value with no distinctive words (all short) can't be judged
// this way, so it is given the benefit of the doubt.
const quoteSupportsValue = (quote: string, value: string): boolean => {
	const nq = normalize(quote)
	const nv = normalize(value)
	if (nv.length > 0 && nq.includes(nv)) return true
	const tokens = salientTokens(value)
	if (tokens.length === 0) return true
	return tokens.some(token => nq.includes(token))
}

// Most of a text's distinctive words appear somewhere in the gathered evidence, so
// it was copied from a real page rather than invented. Used both for a field's
// supporting quote and for a value that is meant to read off the page.
export const isInCorpus = (text: string, lowerCorpus: string): boolean => {
	const tokens = salientTokens(text)
	if (tokens.length === 0) return true
	const corpus = accentFreeCorpus(lowerCorpus)
	const present = tokens.filter(token => corpus.includes(token)).length
	return present / tokens.length >= QUOTE_PRESENCE_THRESHOLD
}

/** Why a per-field scalar was dropped, for the run's grounding trace. */
export type FieldDropReason =
	| 'placeholder'
	| 'wrong_kind'
	| 'ungrounded'
	| 'unsupported'

/**
 * One dropped scalar, recorded so a run can show exactly which field it nulled and
 * why — the signal that turns "location came back empty" into a diagnosable reason
 * instead of a silent blank.
 */
export interface FieldDrop {
	readonly field: string
	readonly reason: FieldDropReason
	/** The dropped value, bounded so a stray long string can't bloat a log line. */
	readonly value: string
	readonly sourceId: string | null
}

export interface ScalarFieldGuardResult {
	readonly findings: unknown
	/** Fields dropped because the value was a placeholder or the field's own name. */
	readonly droppedPlaceholder: number
	/** Fields dropped because the value was the wrong kind of thing (a location that names no place). */
	readonly droppedWrongKind: number
	/** Fields dropped because no fetched source backed the value. */
	readonly droppedUngrounded: number
	/** Fields dropped because the quote did not support or was absent from evidence. */
	readonly droppedUnsupported: number
	/** Each drop with its field, reason, value, and source — for the grounding trace. */
	readonly drops: ReadonlyArray<FieldDrop>
}

// A dropped value is short (a place, an industry code); cap it anyway so a runaway
// string in the value slot can never bloat the per-drop log the guard emits. The
// mark goes on only when something was actually taken off, since a value that was
// never shortened must not wear one saying it was.
const truncateDropValue = (value: string): string => {
	const bounded = clipText(value, 120)
	return bounded === value ? value : `${bounded}…`
}

/**
 * Enforce the grounded-or-absent contract on every per-field `Sourced` scalar in a
 * run's findings. `corpus` is the same evidence text the value guard checks against
 * — the run's fetched pages and tool results, never the model's own prose; pass an
 * empty string to skip the "quote is really in the evidence" check.
 */
export const guardScalarFields = (
	findings: unknown,
	corpus: string,
): ScalarFieldGuardResult => {
	const lowerCorpus = corpus.toLowerCase()
	const drops: FieldDrop[] = []
	// Record a drop and return null (the walk replaces the field with null). The
	// four per-reason counts below are read back off this list, so they can never
	// drift from what was actually dropped.
	const drop = (
		field: string,
		reason: FieldDropReason,
		value: string,
		sourceId: unknown,
	): null => {
		drops.push({
			field,
			reason,
			value: truncateDropValue(value),
			sourceId: typeof sourceId === 'string' ? sourceId : null,
		})
		return null
	}

	const walk = (
		value: unknown,
		key: string | undefined,
		inCompanyProfile: boolean,
	): unknown => {
		if (Array.isArray(value))
			return value.map(item => walk(item, undefined, inCompanyProfile))
		if (value === null || typeof value !== 'object') return value

		if (
			isSourcedField(value) &&
			key !== undefined &&
			(inCompanyProfile || !CHANNEL_KEYS.has(key))
		) {
			const wrapper = value as {
				value: unknown
				source_id?: unknown
				quote?: unknown
			}
			// Only text scalars are judged here; a non-string value is left as-is.
			if (typeof wrapper.value !== 'string') return value
			if (isPlaceholderValue(wrapper.value, key)) {
				return drop(key, 'placeholder', wrapper.value, wrapper.source_id)
			}
			// Not a placeholder, but still the wrong kind of thing for its field.
			if (!valueIsRightKind(key, wrapper.value)) {
				return drop(key, 'wrong_kind', wrapper.value, wrapper.source_id)
			}
			// An unsourced fact is treated as absent: the citation guard has already
			// stripped every fabricated source_id, so a field with none left never
			// reached a fetched page.
			if (
				typeof wrapper.source_id !== 'string' ||
				wrapper.source_id.trim() === ''
			) {
				return drop(key, 'ungrounded', wrapper.value, null)
			}
			const quote =
				typeof wrapper.quote === 'string' ? wrapper.quote.trim() : ''
			if (quote !== '') {
				if (corpus !== '' && !isInCorpus(quote, lowerCorpus)) {
					return drop(key, 'unsupported', wrapper.value, wrapper.source_id)
				}
				if (
					PAGE_LITERAL_FIELDS.has(key) &&
					!quoteSupportsValue(quote, wrapper.value)
				) {
					return drop(key, 'unsupported', wrapper.value, wrapper.source_id)
				}
			}
			return value
		}

		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([k, v]) =>
				SKIP_KEYS.has(k)
					? [k, v]
					: [k, walk(v, k, inCompanyProfile || k === COMPANY_PROFILE_KEY)],
			),
		)
	}

	const guardedFindings = walk(findings, undefined, false)
	const countReason = (reason: FieldDropReason): number =>
		drops.filter(d => d.reason === reason).length
	return {
		findings: guardedFindings,
		droppedPlaceholder: countReason('placeholder'),
		droppedWrongKind: countReason('wrong_kind'),
		droppedUngrounded: countReason('ungrounded'),
		droppedUnsupported: countReason('unsupported'),
		drops,
	}
}
