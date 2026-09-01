/**
 * Email-pattern guessing for contact discovery — turns a person's name plus a
 * company domain into ordered candidate addresses (most common pattern first).
 * Pure and free of I/O so the guess+verify pipeline and its tests drive it
 * directly. Candidates are only ever sent after verification.
 *
 * A name is read into a local part by `collapse`, the same reading the guards
 * put a company name through — `José Núñez` gives `jose` and `nunez`. Not a
 * reading of its own, however self-contained that would leave this file: one
 * kept here once before, and while it quietly disagreed `Straßer` was guessed
 * at `straer@` and `Þór` at `or@`. An address a guess is wrong about is one
 * somebody sends to.
 */

import { collapse } from './entity-guard'

type TokenKey = 'first' | 'last' | 'f' | 'l'

export interface GuessNameInput {
	readonly firstName: string
	readonly lastName: string
	readonly domain: string
	// Optional vendor-detected pattern (e.g. Hunter's `{first}.{last}`); tried
	// first when present.
	readonly pattern?: string | undefined
}

const buildTokens = (
	first: string,
	last: string,
): Record<TokenKey, string> => ({
	first,
	last,
	f: first.slice(0, 1),
	l: last.slice(0, 1),
})

// Fill a `{first}.{last}`-style template. Returns null when a referenced token
// is empty, so a one-word name never yields a dangling separator (`.smith`).
const applyPattern = (
	pattern: string,
	tokens: Record<TokenKey, string>,
): string | null => {
	let missing = false
	const local = pattern.replace(
		/\{(first|last|f|l)\}/g,
		(_match, key: string) => {
			const value = tokens[key as TokenKey]
			if (!value) missing = true
			return value
		},
	)
	return missing || local.length === 0 ? null : local
}

// Local-part patterns ordered by how common they are for B2B domains.
const DEFAULT_PATTERNS = [
	'{first}.{last}',
	'{f}{last}',
	'{first}{last}',
	'{first}',
	'{first}_{last}',
	'{first}{l}',
	'{last}.{first}',
	'{last}',
] as const

export interface PersonName {
	readonly firstName: string
	readonly lastName: string
}

// Countries where a person carries two surnames and the FIRST of them is the one
// they go by — the father's. "María García López" is Señora García, and her
// address is maria.garcia@, never maria.lopez@.
//
// Portugal and Brazil are deliberately absent though they also carry two: there
// the order is the other way round, mother's then father's, so the LAST surname
// is the one they go by and the ordinary reading below is already right.
const FATHERS_SURNAME_COMES_FIRST = new Set([
	'ES',
	'MX',
	'AR',
	'CL',
	'CO',
	'PE',
	'VE',
	'EC',
	'BO',
	'PY',
	'UY',
	'CR',
	'CU',
	'DO',
	'GT',
	'HN',
	'NI',
	'PA',
	'SV',
])

// Little words that are part of the surname following them rather than a name of
// their own — "de la Torre" is one surname. `i` and `y` are the other shape: they
// sit BETWEEN two surnames ("Pujol i Soley") and belong to neither.
const CARRIED_INTO_THE_NEXT_WORD = new Set([
	'de',
	'del',
	'la',
	'las',
	'los',
	'da',
	'das',
	'do',
	'dos',
	'van',
	'von',
	'der',
	'den',
])
const JOINS_TWO_SURNAMES = new Set(['i', 'y'])

// The words of a name, with each little word joined onto the one it belongs to,
// so "Ana de la Torre Ruiz" reads as three names and not five.
//
// A little word is only little when a name comes before it. Opening a name, the
// same spelling is somebody's actual first name — Van Morrison, and Do and Da as
// Korean and Vietnamese given names — and joining it to what follows leaves the
// person with one long first name and no surname at all.
const nameParts = (tokens: ReadonlyArray<string>): ReadonlyArray<string> => {
	const parts: string[] = []
	let carried = ''
	for (const token of tokens) {
		const lower = token.toLowerCase()
		const opensTheName = parts.length === 0 && carried === ''
		if (!opensTheName && JOINS_TWO_SURNAMES.has(lower)) continue
		if (!opensTheName && CARRIED_INTO_THE_NEXT_WORD.has(lower)) {
			carried = carried === '' ? token : `${carried} ${token}`
			continue
		}
		parts.push(carried === '' ? token : `${carried} ${token}`)
		carried = ''
	}
	// A little word with nothing after it is a name's last word, not a carry.
	if (carried !== '') parts.push(carried)
	return parts
}

// Which of a person's surnames they go by, given every surname they carry.
// Two of them and a country that puts the father's first means the first one;
// anything else means the whole of what was given.
const surnameGoneBy = (
	surnames: ReadonlyArray<string>,
	country: string | undefined,
): string | null => {
	if (surnames.length < 2) return null
	if (country === undefined) return null
	return FATHERS_SURNAME_COMES_FIRST.has(country.trim().toUpperCase())
		? (surnames[0] ?? null)
		: null
}

/**
 * Split a single display name into the given name and the surname somebody is
 * actually addressed by.
 *
 * Handles the "SURNAME, Forename" shape registries like Companies House return, as
 * well as plain "First Last". A one-word name becomes the first name with no
 * surname.
 *
 * `country` is where the company is, which is the only thing that can settle a
 * name of three or more words. "María García López" and "Mary Jane Watson" are the
 * same shape, and taking the last word — which is right for Mary — gives López,
 * the mother's surname, which is not what a Spanish or Latin American person is
 * called or how their address is built. Nothing in the name itself says which of
 * the two it is, so with no country given the ordinary reading stands.
 */
export const splitPersonName = (
	name: string,
	country?: string | undefined,
): PersonName => {
	const trimmed = name.trim()
	if (trimmed.includes(',')) {
		const comma = trimmed.indexOf(',')
		const surnames = trimmed.slice(0, comma).trim()
		const first =
			trimmed
				.slice(comma + 1)
				.trim()
				.split(/\s+/)[0] ?? ''
		// This shape says which words are surnames but not which of them the person
		// goes by, so the same reading applies: a register handing back "GARCÍA
		// LÓPEZ, María" means the same woman as "María García López", and she was
		// coming back as garcialopez@ from one and garcia@ from the other.
		const parts = nameParts(surnames.split(/\s+/).filter(t => t.length > 0))
		return {
			firstName: first,
			lastName: surnameGoneBy(parts, country) ?? surnames,
		}
	}
	const parts = nameParts(trimmed.split(/\s+/).filter(t => t.length > 0))
	const first = parts[0] ?? ''
	if (parts.length < 2) return { firstName: first, lastName: '' }

	// Two surnames sit at the end whatever the given name is, so a compound given
	// name like "José María" needs no counting: it is the last two that are
	// surnames, and which of those the person goes by is read the same way.
	const surnames = parts.slice(-2)
	const last =
		(parts.length > 2 ? surnameGoneBy(surnames, country) : null) ??
		parts[parts.length - 1] ??
		''
	return { firstName: first, lastName: last }
}

/** Ordered, de-duplicated candidate emails for a name at a domain. */
export const guessEmails = (input: GuessNameInput): string[] => {
	const first = collapse(input.firstName)
	const last = collapse(input.lastName)
	const domain = input.domain.trim().toLowerCase().replace(/^@+/, '')
	if (!domain || (!first && !last)) return []

	const tokens = buildTokens(first, last)
	const patterns = input.pattern
		? [input.pattern, ...DEFAULT_PATTERNS]
		: DEFAULT_PATTERNS

	const seen = new Set<string>()
	const out: string[] = []
	for (const pattern of patterns) {
		const local = applyPattern(pattern, tokens)
		if (!local) continue
		const email = `${local}@${domain}`
		if (!seen.has(email)) {
			seen.add(email)
			out.push(email)
		}
	}
	return out
}
