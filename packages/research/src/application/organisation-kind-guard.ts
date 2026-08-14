/**
 * Drops a row of a discovery scan that is not a company at all — an association,
 * a federation, a guild, an employers' body, a chamber of commerce, a professional
 * college, or the sector's own system operator.
 *
 * A search for companies in a trade runs straight through those bodies' pages,
 * because that is where the companies are named — the breadth ask sends it there on
 * purpose. What comes back is the members AND the body that published the list, and
 * nothing else in the chain can tell them apart: the size and place filter only
 * drops what states a size or place the request ruled out, and a federation states
 * neither.
 *
 * Two states, and only one of them is a dropped row:
 *  - the run could not confirm a company exists → it stays, marked as a candidate
 *    with its reason. Absence of proof is not proof of absence, and the small firms
 *    a scan is really for are exactly the ones with the thinnest trail.
 *  - the run states the organisation is a body of another kind → it goes. The
 *    question was asked and answered.
 * So this drops only on what a row says about itself, never on a guess: the rows
 * that need dropping name what they are unprompted ("Asociación de instaladores
 * eléctricos de Ourense", "Regional association representing 212 installation
 * companies", "Operador del sistema eléctrico"), and a row that says nothing about
 * its kind is kept.
 *
 * Two things keep a real company that merely belongs to a body from being read as
 * one. A body says what it is first — it is the whole of what it is — so only the
 * opening of a row's own description counts, while a member gets there after saying
 * what it does. And a kind word introduced by a membership word ("miembro de la
 * asociación") describes who the company belongs to, not what it is.
 *
 * It reads Spanish, Catalan and English, which is what the runs are written in, and
 * Galician comes free because it spells the words the same way. It does NOT read
 * French, German, Portuguese, Italian, Dutch or Basque: measured against fifteen
 * European trade bodies it recognised four. A body in one of the others reaches the
 * list as a company. The words and the distances below are read off the phrasings
 * that actually came back, not derived from anything, so each one is a guess that
 * held rather than a rule — which is why the whole approach is a stopgap. Asking
 * the model what kind of organisation a row is would need none of it: it reads
 * every one of those languages, and a body describes itself as one in its own
 * words already. That is the version to build; this is the one that works today
 * for the market being sold to.
 */

import { isPlainObject } from './guard-shapes'

// Words a body of this kind calls itself by, each spelling listed rather than
// matched by prefix so that "asociado" and "asociadas" — what a MEMBER calls
// itself — can never be read as the body it belongs to.
const BODY_WORDS = new Set([
	'asociacion',
	'asociaciones',
	'associacio',
	'associacions',
	'association',
	'associations',
	'federacion',
	'federaciones',
	'federacio',
	'federacions',
	'federation',
	'federations',
	'confederacion',
	'confederaciones',
	'confederacio',
	'confederacions',
	'confederation',
	'gremio',
	'gremios',
	'gremi',
	'gremis',
	'guild',
	'guilds',
	'patronal',
	'patronales',
	'patronals',
])

// Kinds that only a phrase pins down. Each word on its own is something else
// entirely — a "cámara frigorífica" is refrigeration equipment, a "colegio" is a
// school, an "operador" is any operator — so these are matched as a run of
// consecutive words instead.
const BODY_PHRASES: ReadonlyArray<ReadonlyArray<string>> = [
	['colegio', 'oficial'],
	['colegios', 'oficiales'],
	['colegio', 'profesional'],
	['collegi', 'oficial'],
	['collegi', 'professional'],
	['camara', 'de', 'comercio'],
	['cambra', 'de', 'comerc'],
	['chamber', 'of', 'commerce'],
	['operador', 'del', 'sistema'],
	['operadora', 'del', 'sistema'],
	['gestor', 'de', 'la', 'red'],
	['gestor', 'de', 'red'],
	['system', 'operator'],
	['grid', 'operator'],
]

// What a body's name puts between the kind and the trade it covers — "Gremio DE
// instaladores", "Chamber OF commerce". A company that merely borrowed the word for
// its brand has no trade to name, so it never reaches for one of these.
const LINKING_WORDS = new Set(['de', 'del', 'dels', 'd', 'of'])

// How far past the kind word that link may sit: far enough for the adjective a
// body usually carries ("Asociación Provincial de…", "Federación Nacional de…").
const LINK_REACH_WORDS = 3

// Words that turn the kind word before them into a description of something else —
// "association-backed installer" is an installer. A body is never any of these.
const MODIFIER_FOLLOWERS = new Set([
	'backed',
	'led',
	'owned',
	'run',
	'managed',
	'approved',
	'certified',
	'accredited',
	'registered',
	'affiliated',
	'endorsed',
	'respaldado',
	'respaldada',
	'avalado',
	'avalada',
	'certificado',
	'certificada',
])

// Words that turn what follows into somebody the company belongs to rather than
// what the company is.
const MEMBERSHIP_WORDS = new Set([
	'miembro',
	'miembros',
	'membre',
	'membres',
	'member',
	'members',
	'membership',
	'socio',
	'socios',
	'socia',
	'socias',
	'asociado',
	'asociados',
	'asociada',
	'asociadas',
	'associat',
	'associada',
	'afiliado',
	'afiliada',
	'afiliados',
	'afiliadas',
	'afiliat',
	'pertenece',
	'pertenecen',
	'pertany',
	'integrante',
	'integrantes',
	'belongs',
	'affiliated',
])

// How far into a row's own description a kind word still describes the row itself.
// A body leads with what it is — "Asociación de instaladores…", "Regional
// association representing 212 installation companies" — while a company that
// belongs to one first says what it does and gets there later.
const KIND_WINDOW_WORDS = 6

// How far back a membership word still governs the kind word after it: far enough
// for the longest ordinary way of saying it ("member of the Spanish association").
const MEMBERSHIP_LOOKBACK_WORDS = 5

// Accent-folded words, with the Catalan interpunct removed rather than split on so
// "Col·legi" reads as one word. An apostrophe is left to split, because the one it
// writes is an elided link — "d'Enginyers" is "de Enginyers", and that link is what
// tells a body's name from a company that borrowed the word.
const wordsOf = (value: string): ReadonlyArray<string> =>
	value
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/·/g, '')
		.split(/[^a-z0-9]+/)
		.filter(Boolean)

// Whether a membership word governs the kind word at this position.
const isGoverned = (words: ReadonlyArray<string>, at: number): boolean =>
	words
		.slice(Math.max(0, at - MEMBERSHIP_LOOKBACK_WORDS), at)
		.some(word => MEMBERSHIP_WORDS.has(word))

// The phrase starting at this position, if one does.
const phraseAt = (
	words: ReadonlyArray<string>,
	at: number,
): string | undefined => {
	for (const phrase of BODY_PHRASES) {
		const matches = phrase.every((word, offset) => words[at + offset] === word)
		if (matches) return phrase.join(' ')
	}
	return undefined
}

// Whether a link to the trade the body covers follows the kind word here.
const linksAfter = (words: ReadonlyArray<string>, at: number): boolean =>
	words
		.slice(at + 1, at + 1 + LINK_REACH_WORDS)
		.some(word => LINKING_WORDS.has(word))

/**
 * What kind of body this text says the organisation is, or nothing when it says
 * none.
 *
 * `windowWords` bounds how far in a kind word still describes the organisation
 * itself — a name is short and says what it is throughout, a description only at
 * its opening.
 *
 * `needsLink` is what separates a body's name from a company that took the word
 * for its brand. A body's name gives the trade it covers — "Gremio de Instaladores
 * de Madrid" — while "El Gremio Taberna" and "Guild Software" name no trade,
 * because they are not covering one. A description is not held to this: a body
 * writing about itself has no reason to phrase it that way. A phrase is not held
 * to it either — nobody trades under "cámara de comercio".
 */
const bodyKindIn = (
	text: string | undefined,
	windowWords: number,
	needsLink: boolean,
): string | undefined => {
	if (typeof text !== 'string') return undefined
	const words = wordsOf(text)
	for (let at = 0; at < Math.min(words.length, windowWords); at++) {
		if (isGoverned(words, at)) continue
		// The kind word is describing the next word rather than the organisation.
		if (MODIFIER_FOLLOWERS.has(words[at + 1] ?? '')) continue
		const word = words[at] ?? ''
		if (BODY_WORDS.has(word) && (!needsLink || linksAfter(words, at)))
			return word
		const phrase = phraseAt(words, at)
		if (phrase !== undefined) return phrase
	}
	return undefined
}

// Where a row describes itself in its own words. A prospect gives its rationale and
// the trade it was filed under; a competitor gives a description instead. Both lists
// are read, so neither can quietly go unchecked for the want of a field name.
const DESCRIPTION_FIELDS = ['why_relevant', 'description', 'industry'] as const

const textAt = (
	row: Record<string, unknown>,
	field: string,
): string | undefined =>
	typeof row[field] === 'string' ? row[field] : undefined

// What kind of body a row states it is, or nothing when it states none.
const statedBodyKind = (row: Record<string, unknown>): string | undefined => {
	// A name is short and is what the organisation calls itself throughout, so it
	// counts wherever the word sits — but only where it names a trade to cover.
	const named = bodyKindIn(textAt(row, 'name'), Number.POSITIVE_INFINITY, true)
	if (named !== undefined) return named
	for (const field of DESCRIPTION_FIELDS) {
		const stated = bodyKindIn(textAt(row, field), KIND_WINDOW_WORDS, false)
		if (stated !== undefined) return stated
	}
	return undefined
}

/** One dropped row, for the log: who it was and the words that decided it. */
export interface DroppedOrganisation {
	readonly name: string
	readonly kind: string
}

export interface OrganisationKindResult {
	readonly findings: unknown
	readonly dropped: ReadonlyArray<DroppedOrganisation>
}

/**
 * `listField` is the key holding this scan's companies — `prospects` or
 * `competitors`. Anything else passes through untouched: only a scan produces a
 * list of organisations nobody vouched for, and a run about one named company was
 * told which company to research.
 */
export const dropNonCompanies = (
	findings: unknown,
	listField: string | undefined,
): OrganisationKindResult => {
	if (listField === undefined) return { findings, dropped: [] }

	const dropped: Array<DroppedOrganisation> = []
	const walk = (value: unknown, key?: string): unknown => {
		if (Array.isArray(value)) {
			if (key === listField) {
				return value.filter(row => {
					if (!isPlainObject(row)) return true
					const kind = statedBodyKind(row)
					if (kind === undefined) return true
					dropped.push({
						name: typeof row['name'] === 'string' ? row['name'] : '',
						kind,
					})
					return false
				})
			}
			return value.map(item => walk(item))
		}
		if (isPlainObject(value)) {
			return Object.fromEntries(
				Object.entries(value).map(([k, v]) => [k, walk(v, k)] as const),
			)
		}
		return value
	}

	return { findings: walk(findings), dropped }
}
