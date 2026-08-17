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

/**
 * Split a single display name into first + last. Handles the
 * "SURNAME, Forename" shape registries like Companies House return, as well as
 * plain "First Last". A one-word name becomes the first name with no surname.
 */
export const splitPersonName = (name: string): PersonName => {
	const trimmed = name.trim()
	if (trimmed.includes(',')) {
		const comma = trimmed.indexOf(',')
		const last = trimmed.slice(0, comma).trim()
		const first =
			trimmed
				.slice(comma + 1)
				.trim()
				.split(/\s+/)[0] ?? ''
		return { firstName: first, lastName: last }
	}
	const tokens = trimmed.split(/\s+/).filter(t => t.length > 0)
	return {
		firstName: tokens[0] ?? '',
		lastName: tokens.length > 1 ? (tokens[tokens.length - 1] ?? '') : '',
	}
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
