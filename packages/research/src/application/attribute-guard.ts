/**
 * Hold a run's attribute values to the same standard as every other sourced
 * value, and to their kind.
 *
 * A value stays only when the organisation declared its key for this run, a
 * fetched page is named for it, the words quoted for it really appear in what
 * the run read, that page is a page rather than a post and speaks for the right
 * company, and the value reads as the kind the key was declared with — a number
 * the quote states, a choice from the declared words, a date that names a day, a
 * yes or a no, text the quote supports. What is kept is the typed value with its
 * citation, which is what the CRM column stores.
 *
 * Graded here and nowhere else: the scalar guard walks past the attribute map on
 * purpose, so an entry is judged once, by rules that know its kind.
 */

import {
	type AttributeValue,
	coerceAttributeValue,
	type ResearchAttributeDeclaration,
} from '@batuda/domain'

import { ATTRIBUTES_FIELD } from './attribute-bag'
import { discoveryResultField, isDiscoveryScan } from './discovery-scan'
import { classifyNamespace } from './entity-source-guard'
import { isPlainObject } from './guard-shapes'
import {
	isInCorpus,
	isPlaceholderValue,
	quoteStatesNumber,
	quoteSupportsValue,
} from './scalar-field-guard'

export type AttributeDropReason =
	| 'undeclared'
	| 'ungrounded'
	| 'unquoted'
	| 'unsupported'
	| 'off_entity'
	| 'wrong_kind'

export interface AttributeDrop {
	readonly key: string
	readonly reason: AttributeDropReason
}

export interface AttributeGuardResult {
	readonly findings: unknown
	/** Values that survived, across every company the findings hold. */
	readonly kept: number
	readonly drops: ReadonlyArray<AttributeDrop>
}

/** Whether the page a value cites reads as a company other than the run's. */
export type OffEntityCheck = (sourceId: string) => boolean

// The value the way its kind reads it, or null when it does not read that way
// or the quote does not carry it. A number is held to the digits the quote
// writes; a date to the year the quote names; text to the words in the quote.
// A yes/no and a choice stand on the quote being real, which was checked before.
const readsAsKind = (
	declaration: ResearchAttributeDeclaration,
	raw: unknown,
	quote: string,
): AttributeValue | null => {
	const value = coerceAttributeValue(
		declaration.kind,
		raw,
		declaration.enumValues,
	)
	if (value === null) return null
	switch (declaration.kind) {
		case 'number':
			return typeof value === 'number' && quoteStatesNumber(quote, value)
				? value
				: null
		case 'date':
			return typeof value === 'string' && quote.includes(value.slice(0, 4))
				? value
				: null
		case 'text':
			return typeof value === 'string' &&
				!isPlaceholderValue(value, declaration.key) &&
				quoteSupportsValue(quote, value, true)
				? value
				: null
		default:
			return value
	}
}

const guardMap = (
	map: Record<string, unknown>,
	declared: ReadonlyMap<string, ResearchAttributeDeclaration>,
	corpus: string,
	lowerCorpus: string,
	offEntity: OffEntityCheck,
	drops: AttributeDrop[],
): Record<string, unknown> => {
	const kept: Array<[string, Record<string, unknown>]> = []
	for (const [key, entry] of Object.entries(map)) {
		const declaration = declared.get(key)
		if (declaration === undefined) {
			drops.push({ key, reason: 'undeclared' })
			continue
		}
		const sourceId = isPlainObject(entry) ? entry['source_id'] : undefined
		if (
			!isPlainObject(entry) ||
			typeof sourceId !== 'string' ||
			sourceId.trim() === ''
		) {
			drops.push({ key, reason: 'ungrounded' })
			continue
		}
		const quote =
			typeof entry['quote'] === 'string' ? entry['quote'].trim() : ''
		if (quote === '') {
			drops.push({ key, reason: 'unquoted' })
			continue
		}
		if (corpus !== '' && !isInCorpus(quote, lowerCorpus)) {
			drops.push({ key, reason: 'unsupported' })
			continue
		}
		if (classifyNamespace(sourceId) !== null || offEntity(sourceId)) {
			drops.push({ key, reason: 'off_entity' })
			continue
		}
		const value = readsAsKind(declaration, entry['value'], quote)
		if (value === null) {
			drops.push({ key, reason: 'wrong_kind' })
			continue
		}
		kept.push([key, { ...entry, value }])
	}
	return Object.fromEntries(kept)
}

// The holder with its map graded, or with the map gone when nothing survived
// — an empty map would read as "nothing declared" to a reader, which it is not.
const guardHolder = (
	holder: Record<string, unknown>,
	declared: ReadonlyMap<string, ResearchAttributeDeclaration>,
	corpus: string,
	lowerCorpus: string,
	offEntity: OffEntityCheck,
	drops: AttributeDrop[],
): { readonly holder: Record<string, unknown>; readonly kept: number } => {
	const map = holder[ATTRIBUTES_FIELD]
	if (map === undefined) return { holder, kept: 0 }
	const { [ATTRIBUTES_FIELD]: _map, ...rest } = holder
	if (!isPlainObject(map)) {
		// Whatever arrived is not a map of values, so all of it goes; there is no key
		// to name it by.
		drops.push({ key: '', reason: 'ungrounded' })
		return { holder: rest, kept: 0 }
	}
	const graded = guardMap(map, declared, corpus, lowerCorpus, offEntity, drops)
	const kept = Object.keys(graded).length
	return kept === 0
		? { holder: rest, kept: 0 }
		: { holder: { ...rest, [ATTRIBUTES_FIELD]: graded }, kept }
}

/**
 * `corpus` is the evidence the run read; pass an empty string to skip the
 * "the quote is really in the evidence" check. `offEntity` says whether a cited
 * page was fetched and reads as another company; left out, only the page's
 * address is judged.
 */
export const guardAttributes = (
	findings: unknown,
	corpus: string,
	declarations: ReadonlyArray<ResearchAttributeDeclaration>,
	schemaName: string,
	offEntity: OffEntityCheck = () => false,
): AttributeGuardResult => {
	if (!isPlainObject(findings)) return { findings, kept: 0, drops: [] }
	const declared = new Map(declarations.map(d => [d.key, d]))
	const lowerCorpus = corpus.toLowerCase()
	const drops: AttributeDrop[] = []
	if (!isDiscoveryScan(schemaName)) {
		const result = guardHolder(
			findings,
			declared,
			corpus,
			lowerCorpus,
			offEntity,
			drops,
		)
		return { findings: result.holder, kept: result.kept, drops }
	}
	const field = discoveryResultField(schemaName)
	const rows = field === undefined ? undefined : findings[field]
	if (field === undefined || !Array.isArray(rows))
		return { findings, kept: 0, drops }
	let kept = 0
	let changed = false
	const graded = rows.map(row => {
		if (!isPlainObject(row)) return row
		const result = guardHolder(
			row,
			declared,
			corpus,
			lowerCorpus,
			offEntity,
			drops,
		)
		kept += result.kept
		if (result.holder !== row) changed = true
		return result.holder
	})
	return {
		findings: changed ? { ...findings, [field]: graded } : findings,
		kept,
		drops,
	}
}
