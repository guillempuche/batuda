/**
 * Takes back a prospect's "could not confirm" mark when the reason it gives does
 * nothing but name the row's own blank columns.
 *
 * The mark answers one question: does the evidence establish that this is a real,
 * trading company? Asked for it beside a request that wants a "no confirmado"
 * marker on some hard-to-pin-down field, a run reaches for the nearest thing that
 * looks like one and writes "no website, no employee figure". That is not doubt
 * about the company — it is the row restating which of its columns are blank,
 * which anyone can already see. Left alone it lands on almost every row, so the
 * mark stops telling a reader anything, and it holds back the vouching step on
 * leads whose only fault is a blank column.
 *
 * The reason is taken back only when every part of it is a column named and
 * nothing else. One word the row's own columns and the ordinary wording around a
 * blank cannot account for — "no trace in any register", "the address belongs to
 * another company" — is the run saying something about the company, and the mark
 * stays whole. Whether the column named is still empty by the time this runs makes
 * no difference: a later round often fills it, which leaves the reason describing
 * a gap that has since closed, and that is if anything a plainer case of a mark
 * that was never about the company at all.
 */

import { isPlainObject } from './guard-shapes'

// What a row's own fields get called in a reason, in the languages a run writes
// one in. Only fields a scan row actually has: a word for something the row cannot
// hold is not the row reading itself back.
const FIELD_WORDS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
	[
		'website',
		['website', 'web', 'webpage', 'site', 'url', 'sitio', 'pagina', 'lloc'],
	],
	[
		'employee_estimate',
		[
			'employee',
			'employees',
			'headcount',
			'staff',
			'workforce',
			'empleado',
			'empleados',
			'plantilla',
			'trabajadores',
			'treballadors',
		],
	],
	[
		'location',
		[
			'location',
			'address',
			'city',
			'town',
			'province',
			'region',
			'autonomous',
			'ubicacion',
			'ubicacio',
			'localizacion',
			'direccion',
			'provincia',
			'ciudad',
			'municipio',
			'poblacion',
			'sede',
			'comunidad',
			'community',
		],
	],
	['tax_id', ['cif', 'nif', 'vat', 'fiscal']],
	['industry', ['industry', 'sector', 'actividad', 'activitat']],
]

// Where one part of a reason ends and the next begins: the punctuation and the
// joining words a run writes a list of gaps with.
const CLAUSE_BREAK = /[,;/()]|\b(?:and|or|y|e|o|u|i|ni|nor)\b/i

// The ordinary wording that surrounds a named blank — "no exact employee figure",
// "número de empleados no confirmado". Listing it is what separates a part that is
// only pointing at an empty column from one that happens to mention a column while
// saying something about the company.
const FILLER_WORDS = new Set([
	'no',
	'not',
	'non',
	'none',
	'nor',
	'without',
	'sin',
	'ni',
	'exact',
	'exacta',
	'exacto',
	'precise',
	'precisa',
	'single',
	'unico',
	'unica',
	'figure',
	'figures',
	'count',
	'number',
	'numero',
	'cifra',
	'xifra',
	'data',
	'dato',
	'datos',
	'dades',
	'information',
	'informacion',
	'info',
	'confirmed',
	'confirmado',
	'confirmada',
	'confirmat',
	'unconfirmed',
	'published',
	'publicado',
	'publicada',
	'publicat',
	'found',
	'encontrado',
	'encontrada',
	'trobat',
	'available',
	'disponible',
	'official',
	'oficial',
	'specific',
	'especifico',
	'especifica',
	'listed',
	'listado',
	'in',
	'evidence',
	'evidencia',
	'evidencias',
	'aparece',
	'aparecen',
	'stated',
	'indicado',
	'provided',
	'proporcionado',
	'given',
	'dado',
	'the',
	'a',
	'an',
	'its',
	'su',
	'sus',
	'de',
	'del',
	'la',
	'el',
	'los',
	'las',
	'un',
	'una',
	'en',
	'on',
	'for',
	'of',
	'any',
	'alguna',
	'alguno',
	'ningun',
	'ninguna',
])

// Whether a word is either one of the row's own field names or the ordinary
// wording around a blank. Anything else is the run saying something the row's
// columns do not account for.
const isAccountedFor = (word: string): boolean =>
	FILLER_WORDS.has(word) ||
	FIELD_WORDS.some(([, names]) => names.includes(word))

const wordsOf = (value: string): ReadonlyArray<string> =>
	value
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean)

// Whether this part of the reason names one of the row's own columns at all. A
// part naming none of them is about something else, whatever else it says.
const namesAField = (clause: string): boolean => {
	const words = new Set(wordsOf(clause))
	return FIELD_WORDS.some(([, names]) => names.some(name => words.has(name)))
}

// Whether the whole reason is the row reading its own columns back.
const readsOwnGaps = (reason: string): boolean => {
	const clauses = reason
		.split(CLAUSE_BREAK)
		.filter(clause => clause !== undefined && wordsOf(clause).length > 0)
	if (clauses.length === 0) return false
	return clauses.every(
		clause =>
			namesAField(clause) &&
			wordsOf(clause).every(word => isAccountedFor(word)),
	)
}

export interface UnconfirmedMarkResult {
	readonly findings: unknown
	/** Marks taken back for naming the row's own columns and nothing else. */
	readonly cleared: number
}

/**
 * `listField` is the key holding this scan's companies. Anything else passes
 * through: only a scan's row carries a mark of this kind.
 */
export const clearFieldOnlyDoubt = (
	findings: unknown,
	listField: string | undefined,
): UnconfirmedMarkResult => {
	if (listField === undefined) return { findings, cleared: 0 }

	let cleared = 0
	const walk = (value: unknown, key?: string): unknown => {
		if (Array.isArray(value)) {
			if (key === listField) {
				return value.map(row => {
					if (!isPlainObject(row)) return row
					const reason = row['unconfirmed_reason']
					if (typeof reason !== 'string' || !readsOwnGaps(reason)) {
						return row
					}
					cleared++
					// Dropped rather than emptied, so the row reads as one the model
					// never marked — the same as any other field a guard removes.
					const { unconfirmed_reason: _taken, ...rest } = row
					return rest
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

	return { findings: walk(findings), cleared }
}
