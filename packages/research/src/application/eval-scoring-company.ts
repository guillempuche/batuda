/**
 * Grading one company's profile: whether a run reached the target's own site, and
 * whether each field it filled matches the known answer.
 *
 * Matching is per field, and each rule is written to forgive a difference in spelling
 * that a reader would not count as a miss — a phone number by its digits, a
 * registration number by its letters and digits, an industry by the trade rather than
 * the wording. What none of them forgive is a different company's answer.
 *
 * A market request is graded by eval-scoring-market.ts instead; it answers with a list
 * and has no profile of its own for any of this to read.
 */

import { foldLabel } from '@batuda/domain'

import {
	type GoldenExpectation,
	normalizeText,
	type RunOutcome,
	type ScorableField,
} from './eval-scoring-types'
import { foldDiacritics } from './term-match'

/**
 * Bare registrable host, lowercased, without scheme / `www.` / path — so
 * "https://www.Acme.com/contact" and "acme.com" compare equal.
 */
export const normalizeDomain = (value: string): string => {
	const withoutScheme = value
		.trim()
		.toLowerCase()
		.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
	const host = withoutScheme.split('/')[0] ?? withoutScheme
	return host.replace(/^www\./, '')
}

export const isFilled = (value: string | null | undefined): value is string =>
	typeof value === 'string' && value.trim().length > 0

// Titles a page prints before a name ("Sir James Dyson", "Dr Jane Roe"): not part of
// the name, so a leading one is dropped before matching. "Don"/"Doña" are deliberately
// absent — "Don" is also a real given name (Don Draper), and dropping it would lose a
// real person. Only stripped when two tokens remain, so a short "Dr Dre" keeps both.
const HONORIFICS = new Set([
	'sir',
	'dame',
	'lord',
	'lady',
	'mr',
	'mrs',
	'ms',
	'miss',
	'mx',
	'dr',
	'prof',
	'professor',
	'rev',
	'reverend',
	'hon',
	'madam',
	'madame',
])

// Everyday short forms folded to the formal name a company usually publishes, so a
// golden "Pete Roever" matches a run's "Peter Roever". Kept small and English; since a
// match still needs the surname too (≥2 tokens), folding a first name can't collapse
// two genuinely different people.
const NICKNAMES: Record<string, string> = {
	pete: 'peter',
	rob: 'robert',
	bob: 'robert',
	robbie: 'robert',
	bill: 'william',
	billy: 'william',
	tony: 'anthony',
	jim: 'james',
	jimmy: 'james',
	mike: 'michael',
	dave: 'david',
	tom: 'thomas',
	tommy: 'thomas',
	dan: 'daniel',
	danny: 'daniel',
	dick: 'richard',
	rick: 'richard',
	matt: 'matthew',
	greg: 'gregory',
	ben: 'benjamin',
	ed: 'edward',
	eddie: 'edward',
	andy: 'andrew',
	ron: 'ronald',
	ken: 'kenneth',
	joe: 'joseph',
	steve: 'steven',
	nick: 'nicholas',
	tim: 'timothy',
	charlie: 'charles',
}

const stripHonorific = (
	tokens: ReadonlyArray<string>,
): ReadonlyArray<string> =>
	tokens.length > 2 && HONORIFICS.has(tokens[0] ?? '')
		? tokens.slice(1)
		: tokens

// A person's name as its accent-folded, lower-cased word tokens, with a leading
// honorific dropped and each token folded to its formal form. Single-character tokens
// (a middle initial) are kept, so two people who differ only by initial stay distinct.
const nameTokens = (name: string): ReadonlyArray<string> => {
	const rawTokens = foldDiacritics(name)
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(token => token.length > 0)
	return stripHonorific(rawTokens).map(token => NICKNAMES[token] ?? token)
}

// Two names refer to the same person when the shorter one's tokens are all in the
// longer's — so "Andrew Smith" matches "Andrew J. Smith" without matching a
// different Smith. A lone shared token (just a first name) is too weak to confirm
// the same person, so the shorter name must carry at least two tokens. Shared with
// the contact-discovery eval, so both agree on what "same person" means. Conservative
// on purpose: an unmatched real person is a miss the eval should show, not paper over.
export const contactNameMatches = (
	expected: string,
	actual: string,
): boolean => {
	const e = nameTokens(expected)
	const a = nameTokens(actual)
	const [small, big] = e.length <= a.length ? [e, new Set(a)] : [a, new Set(e)]
	if (small.length < 2) return false
	return small.every(token => big.has(token))
}

/**
 * A trade is whatever the page calls it, on both sides: the golden holds the
 * wording a person would expect, and the pipeline keeps the wording it read. So
 * this asks whether the two namings are the same trade, not whether they are the
 * same string.
 *
 * `foldLabel` is the same rule the CRM uses to decide that two spellings are one
 * trade, so a difference this accepts is a difference that would land on one
 * entry there. On top of it, a shared stem — a prefix at least half the expected
 * name's length, minimum four characters, starting some word of what was read —
 * covers the endings a language puts on the same word ("fusteria" against
 * "fusteries", "manufacturing" against "manufacturer").
 *
 * A real miss still reads as one: a bank reported as "banking" against an
 * expected "insurance" shares no stem, which is the signal the eval is for.
 */
const industryMatches = (expected: string, actual: string): boolean => {
	const foldedExpected = foldLabel(expected)
	const foldedActual = foldLabel(actual)
	if (foldedExpected.length === 0 || foldedActual.length === 0) return false
	if (
		foldedActual.includes(foldedExpected) ||
		foldedExpected.includes(foldedActual)
	)
		return true
	const stem = foldedExpected.slice(
		0,
		Math.max(4, Math.ceil(foldedExpected.length / 2)),
	)
	return foldedActual.split(' ').some(word => word.startsWith(stem))
}

export const fieldMatches = (
	field: ScorableField,
	expected: string,
	actual: string,
): boolean => {
	const normalizedExpected = normalizeText(expected)
	const normalizedActual = normalizeText(actual)
	if (normalizedExpected.length === 0 || normalizedActual.length === 0)
		return false
	// A location is written differently by every source (order, abbreviations,
	// postcode placement), so accept either string containing the other rather than
	// demanding a character-exact match.
	if (field === 'location') {
		return (
			normalizedActual.includes(normalizedExpected) ||
			normalizedExpected.includes(normalizedActual)
		)
	}
	if (field === 'industry') {
		return industryMatches(normalizedExpected, normalizedActual)
	}
	// A telephone number is printed a dozen ways for the same line — spaces, dots,
	// brackets, a country code on one page and not the next — so only the digits
	// are compared, and only the last nine of them, which is a full national number
	// everywhere the pipeline researches. Anything shorter is compared whole.
	if (field === 'phone') {
		const lastDigits = (value: string): string => {
			const digits = value.replace(/\D/g, '')
			return digits.length > 9 ? digits.slice(-9) : digits
		}
		const expectedDigits = lastDigits(expected)
		return expectedDigits !== '' && lastDigits(actual) === expectedDigits
	}
	// A registration number is written with and without its punctuation and its
	// country prefix, so it is compared on its letters and digits alone.
	if (field === 'tax_id') {
		const bare = (value: string): string =>
			value.replace(/[^a-z0-9]/gi, '').toUpperCase()
		const expectedBare = bare(expected)
		return expectedBare !== '' && bare(actual) === expectedBare
	}
	// An email address, a country code and a size band are all values the pipeline
	// is meant to emit verbatim, so they hold to an exact match.
	return normalizedActual === normalizedExpected
}

// Global cities so common that a company being there says little about which company
// it is — a location match on one of these is too weak to confirm the run reached the
// right company. Normalized once so lookups match the folded field value.
const MEGACITIES = new Set(
	[
		'london',
		'paris',
		'madrid',
		'barcelona',
		'berlin',
		'milan',
		'rome',
		'new york',
		'new york city',
		'nyc',
		'los angeles',
		'chicago',
		'san francisco',
		'boston',
		'dublin',
		'amsterdam',
		'lisbon',
		'tokyo',
		'singapore',
		'hong kong',
		'shanghai',
		'beijing',
		'mumbai',
		'delhi',
		'mexico city',
		'sao paulo',
		'buenos aires',
		'toronto',
		'sydney',
	].map(normalizeText),
)

// Whether the run's location matches the golden's AND that location is specific enough
// to identify the company (not a global capital). Used only to judge that a run
// reached the right company when it never touched the official domain — a stronger
// signal than a coarse industry code, which is shared by many firms.
export const specificLocationAgrees = (
	expected: GoldenExpectation,
	outcome: RunOutcome,
): boolean => {
	const goldenLocation = expected.fields.location
	const actual = outcome.fields.location
	if (goldenLocation === undefined || !isFilled(actual)) return false
	// Judge the city (the part before any region/country) against the megacity list,
	// so "London, UK" is recognised as generic just as bare "London" is.
	const goldenCity = normalizeText(
		goldenLocation.split(',')[0] ?? goldenLocation,
	)
	if (MEGACITIES.has(goldenCity)) return false
	return fieldMatches('location', goldenLocation, actual)
}
