// Shared rule for "does this read as a person's name" — used wherever a contact is
// folded in, so an email address, a phone number, or a stray testimonial first name
// is never counted as a person twice over by two guards disagreeing.

import { LEGAL_SUFFIXES } from './entity-guard'
import { termTokens } from './term-match'

const HAS_AT_SIGN = /@/
const HAS_URL_SCHEME = /:\/\//
const HAS_WWW = /www\./i
// A bare host or domain, not a URL: "acme.es" has no scheme and no "www." to catch it.
const ENDS_LIKE_A_TLD = /\.[a-z]{2,24}$/i
const ONLY_PHONE_CHARACTERS = /^[\d\s+\-().]+$/
const HAS_A_DIGIT = /\d/
const A_BRACKETED_ASIDE = /\s*\([^()]*\)/g
const A_LATIN_LETTER = /\p{Script=Latin}/u
const A_RUN_OF_LETTERS = /\p{L}+/gu

const readsAsAddressOrNumber = (name: string): boolean => {
	const trimmed = name.trim()
	if (trimmed === '') return true
	if (HAS_AT_SIGN.test(trimmed)) return true
	if (
		HAS_URL_SCHEME.test(trimmed) ||
		HAS_WWW.test(trimmed) ||
		ENDS_LIKE_A_TLD.test(trimmed)
	)
		return true
	// Phone punctuation alone (no digit) is just punctuation, not a number — keep
	// that case out so an empty/blank name isn't double-counted as a phone number.
	return ONLY_PHONE_CHARACTERS.test(trimmed) && HAS_A_DIGIT.test(trimmed)
}

/**
 * The name with any bracketed aside removed and whitespace collapsed —
 * "Stéphane (Cutting-folding, Bordeaux)" becomes "Stéphane". This is what a
 * contact is kept and keyed under, so a name with and without its aside key the
 * same rather than reading as two different people.
 */
export const personName = (name: string): string =>
	name.replace(A_BRACKETED_ASIDE, ' ').replace(/\s+/g, ' ').trim()

/**
 * Whether a string reads as a person's name rather than a contact channel that
 * got folded in under the name field.
 *
 * A recruitment testimonial's first names ("Maryline", "Stéphane") and an aside
 * naming a place ("Stéphane (Cutting-folding, Bordeaux)") both fail on the same
 * ground as a bare email or phone number: after the aside is stripped, a name
 * written in a Latin script needs two tokens to say who somebody is, one word
 * does not. A script with no word spaces (Han) or one this rule cannot split
 * meaningfully (Cyrillic, Arabic, Korean) is trusted on its own terms instead —
 * splitting those by word count would refuse names this run actually returns.
 */
export const readsAsPersonName = (name: string): boolean => {
	if (readsAsAddressOrNumber(name)) return false
	const stripped = personName(name)
	if (stripped === '') return false
	if (!A_LATIN_LETTER.test(stripped)) return true
	const tokens = stripped.match(A_RUN_OF_LETTERS) ?? []
	// A name that ends in a legal form ("Pronimetal S.L.", "Acme Industries
	// GmbH") is the company's. The form has to look like one, dotted, in
	// capitals or after two other words: "Sa" and "Co" are surnames too, and
	// "Paulo Sa" is a person.
	const words = stripped.split(/\s+/)
	const lastWord = words[words.length - 1] ?? ''
	const form = lastWord.replace(/[^\p{L}]/gu, '').toLowerCase()
	const looksLikeAForm =
		lastWord.includes('.') ||
		lastWord === lastWord.toUpperCase() ||
		words.length >= 3
	return tokens.length >= 2 && !(looksLikeAForm && LEGAL_SUFFIXES.has(form))
}

// The labels a site puts beside the people who made the site — the credits on a
// legal-notice page — rather than beside the people who run the company. Read
// with accents off and in lower case, so "Vidéo" and "video" are one label.
const SITE_CREDIT_LABELS: ReadonlySet<string> = new Set([
	'photographie',
	'photographies',
	'photo',
	'photos',
	'photography',
	'photographer',
	'fotografia',
	'fotografias',
	'fotografo',
	'fotograf',
	'fotos',
	'video',
	'videos',
	'videaste',
	'webdesign',
	'web design',
	'webdesigner',
	'web designer',
	'diseno web',
	'disseny web',
	'design',
	'graphisme',
	'graphiste',
	'graphic design',
	'grafica',
	'illustration',
	'illustrations',
	'developpement',
	'development',
	'developpeur',
	'developer',
	'desarrollo',
	'desenvolupament',
	'sviluppo',
	'programacion',
	'hebergement',
	'hebergeur',
	'hosting',
	'realisation',
	'conception',
	'creation',
	'creation du site',
	'site realise par',
	'realise par',
	'concu par',
	'credits',
	'creditos',
	'credits photo',
	'redaction',
	'textes',
	'traduction',
	'translation',
	'webmaster',
	'agence',
	'agencia',
	'agence web',
	'maintenance',
])

// A label the way the set above spells it: lower case, accents off, one space
// between words, nothing but letters and digits inside them.
const asLabel = (text: string): string => termTokens(text).join(' ')

/**
 * Whether a label beside a name credits whoever made the site rather than
 * naming a post at the company. "Photographie", "Développement" and "Webdesign"
 * on a legal-notice page are such credits, and the person beside them is the
 * site's photographer or developer, not the company's staff.
 */
export const readsAsSiteCredit = (label: string): boolean =>
	SITE_CREDIT_LABELS.has(asLabel(label))

/**
 * Whether a quote is a credit line and nothing more — the name with a credit
 * label beside it, "Photographie Thierry Laroche", so that with the name taken
 * out what is left is the label alone.
 */
export const isSiteCreditLine = (quote: string, name: string): boolean => {
	const person = asLabel(personName(name))
	if (person === '') return false
	const line = asLabel(quote)
	if (!line.includes(person)) return false
	const rest = line.replace(person, ' ').replace(/\s+/g, ' ').trim()
	return rest !== '' && readsAsSiteCredit(rest)
}
