/**
 * A last-resort recovery for the high-value facts the broad pass and the focused
 * rescues both left empty.
 *
 * The rescues re-read the evidence the run already gathered; this step goes
 * further and fetches new evidence: for each still-empty high-value fact it fires
 * one focused web search, so a fact that was simply not on any page the run
 * reached still has a chance to be found. It fires only for facts that are still
 * blank and is capped, so a complete run pays nothing and an all-empty one cannot
 * loop.
 *
 * A run has one or many subjects. A company profile is one subject — the company
 * the run is about. A discovery scan is one subject per company it found, each
 * with its own blanks. Both are read the same way here, so a scan's list of
 * prospects gets the same recovery a single profile does.
 *
 * This module is the pure part — which subjects to search for, which fact, and
 * the query to fire. The search, source linking, and re-extraction happen in the
 * research service, where a recovered value passes the same grounding guards as
 * any other.
 */

import { mergeContacts } from './contacts-rescue'
import { discoveryResultField, isDiscoveryScan } from './discovery-scan'
import { enrichmentFill } from './extraction-fill'
import { isValueWrapper, unwrapValue } from './guard-shapes'

// The company-profile facts worth spending an extra search on. `size_range` is
// also nudged during the loop (headcount is rarely on the homepage); for the
// other three this step is the only search that goes looking for them.
export const HIGH_VALUE_FIELDS: ReadonlyArray<string> = [
	'country',
	'industry',
	'location',
	'size_range',
]

// The facts worth an extra search on one company a scan found. A scan is asked
// for a list to work through, and a name alone cannot be worked with: the site is
// how someone reaches the company, and the headcount is how they decide whether
// it is worth reaching. Website comes first because it is the one a scan is most
// often asked for and most often misses.
export const SCAN_ROW_FIELDS: ReadonlyArray<string> = [
	'website',
	'employee_estimate',
]

// At most this many extra searches per round for a company profile: an all-empty
// profile would otherwise fire one per field. Any missing field beyond the cap is
// left for the operator to see in the fill telemetry rather than silently searched.
export const MAX_PER_FIELD_SEARCHES = 3

// At most this many extra searches per round for a discovery scan. A scan spreads
// its searches over a whole list of companies rather than the few facts of one,
// so the profile's cap would recover almost nothing; this is larger and still
// bounded, with the round loop's own budget and deadline margins as the real
// governor.
export const MAX_SCAN_ROW_SEARCHES = 8

/** One fact to go looking for, on one of the run's subjects. */
export interface RescueTarget {
	/** The company name to search for. */
	readonly name: string
	/** Which fact to look for. */
	readonly field: string
}

// A profile field holds something usable only when it carries a non-empty string
// value. The wrapper is required, not incidental: this has to agree with the fill
// measurement next door, which reads a bare value as no value at all.
const hasValue = (fieldValue: unknown): boolean =>
	isValueWrapper(fieldValue) &&
	typeof fieldValue.value === 'string' &&
	fieldValue.value.trim() !== ''

/**
 * Whether one company's field in a scan carries a real value.
 *
 * A scan's fields are not shaped like a profile's: most are plain strings, and
 * the headcount is a number paired with the page it was read on. Reading past
 * that pairing keeps a headcount of 40 from being mistaken for a blank simply
 * because it is not a string.
 */
const hasRowValue = (fieldValue: unknown): boolean => {
	const held = unwrapValue(fieldValue)
	if (typeof held === 'string') return held.trim() !== ''
	return typeof held === 'number' && Number.isFinite(held)
}

const enrichmentOf = (
	findings: unknown,
): Record<string, unknown> | undefined => {
	if (findings === null || typeof findings !== 'object') return undefined
	const enrichment = (findings as { enrichment?: unknown }).enrichment
	return enrichment !== null && typeof enrichment === 'object'
		? (enrichment as Record<string, unknown>)
		: undefined
}

/** The companies a scan found, or none when the findings hold no usable list. */
const scanRowsOf = (
	schemaName: string,
	findings: unknown,
): ReadonlyArray<Record<string, unknown>> => {
	const field = discoveryResultField(schemaName)
	if (field === undefined) return []
	if (findings === null || typeof findings !== 'object') return []
	const rows = (findings as Record<string, unknown>)[field]
	if (!Array.isArray(rows)) return []
	return rows.filter(
		(row): row is Record<string, unknown> =>
			row !== null && typeof row === 'object' && !Array.isArray(row),
	)
}

/** The name a scan row goes by, or undefined when it names no company. */
const rowName = (row: Record<string, unknown>): string | undefined => {
	const name = (row as { name?: unknown }).name
	return typeof name === 'string' && name.trim() !== ''
		? name.trim()
		: undefined
}

/**
 * The key two mentions of the same company share.
 *
 * A re-extraction reads the same company off a different page and writes the name
 * with different spacing or punctuation — `Acme S.L.` against `Acme S.L`. Folding
 * those together keeps one company from becoming two rows. It stops at
 * punctuation and case on purpose: dropping a legal suffix would fold `Acme` and
 * `Acme Holding` into one, and putting a recovered website on the wrong company
 * is far worse than listing it twice.
 */
const nameKey = (name: string): string =>
	name.toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim()

/**
 * The still-empty high-value facts worth a focused search, in a stable order.
 *
 * For a company profile that is the one subject's empty fields; for a discovery
 * scan it is one entry per company that is missing one. Empty when there is
 * nothing left to recover.
 */
export const needsPerFieldSearch = (args: {
	readonly findings: unknown
	readonly schemaName: string
	/** The subject's own name, used for a company profile's single subject. */
	readonly subjectName: string
}): ReadonlyArray<RescueTarget> => {
	// The schema decides which shape to read, not whether a list happens to hold
	// anything: a scan that came back with nothing is still a scan, and reading it
	// as a profile would search for facts it has nowhere to put.
	if (isDiscoveryScan(args.schemaName)) {
		const targets: RescueTarget[] = []
		for (const row of scanRowsOf(args.schemaName, args.findings)) {
			const name = rowName(row)
			if (name === undefined) continue
			for (const field of SCAN_ROW_FIELDS) {
				if (!hasRowValue(row[field])) targets.push({ name, field })
			}
		}
		return targets
	}
	// No profile block means no slot to write a recovered value into, so a search
	// would only pay for an answer with nowhere to go.
	if (enrichmentOf(args.findings) === undefined) return []
	const missing = new Set(enrichmentFill(args.findings).missing)
	return HIGH_VALUE_FIELDS.filter(field => missing.has(field)).map(field => ({
		name: args.subjectName,
		field,
	}))
}

/** How many searches one round may fire for this shape of run. */
export const perFieldSearchCap = (schemaName: string): number =>
	isDiscoveryScan(schemaName) ? MAX_SCAN_ROW_SEARCHES : MAX_PER_FIELD_SEARCHES

// A short, human-readable label per fact, used to phrase the search.
const FIELD_INTENT: Record<string, string> = {
	country: 'head office country',
	employee_estimate: 'number of employees',
	industry: 'industry sector',
	location: 'headquarters city address',
	size_range: 'number of employees',
	website: 'official website',
}

/**
 * A focused web-search query for one missing fact: the company name (quoted so
 * search treats it as a phrase), the city if one was queried, and the fact wanted.
 * Example: `"Acme Corp" Barcelona number of employees`.
 */
export const perFieldSearchQuery = (
	name: string,
	city: string | undefined,
	field: string,
): string => {
	const intent = FIELD_INTENT[field] ?? field
	const cityPart = city && city.trim() !== '' ? ` ${city.trim()}` : ''
	return `"${name.trim()}"${cityPart} ${intent}`
}

// The people a set of findings names, or none when it names nobody.
const contactsOf = (
	findings: unknown,
): ReadonlyArray<Record<string, unknown>> => {
	if (findings === null || typeof findings !== 'object') return []
	const contacts = (findings as { contacts?: unknown }).contacts
	return Array.isArray(contacts)
		? (contacts as ReadonlyArray<Record<string, unknown>>)
		: []
}

export interface PerFieldMerge {
	readonly findings: unknown
	/** How many empty facts the second look filled in. */
	readonly filled: number
	/** Whether the people list gained anyone, or gained a detail about anyone. */
	readonly contactsChanged: boolean
	/** How many companies the second look added that the first pass never named. */
	readonly added: number
}

/**
 * Fold a re-extraction over the enlarged evidence back into a scan's list.
 *
 * A company already found keeps everything it already had — a second look may
 * only fill a blank, never overwrite a grounded value, and never remove a company
 * from the list. A company the re-extraction names that the first pass did not is
 * appended: the enlarged evidence is a wider read of the same question, so what it
 * turns up is a find rather than a contradiction.
 */
const mergeScanRows = (
	schemaName: string,
	findings: unknown,
	refreshed: unknown,
): PerFieldMerge => {
	const field = discoveryResultField(schemaName)
	const known = scanRowsOf(schemaName, findings)
	const found = scanRowsOf(schemaName, refreshed)
	// An empty list of known companies is still worth folding into — the wider read
	// can name companies the first pass missed entirely, which is the whole point
	// of looking again. Only findings with nowhere to write are left alone.
	if (
		field === undefined ||
		found.length === 0 ||
		findings === null ||
		typeof findings !== 'object'
	) {
		return { findings, filled: 0, contactsChanged: false, added: 0 }
	}
	const foundByName = new Map<string, Record<string, unknown>>()
	for (const row of found) {
		const name = rowName(row)
		// First mention wins: a later duplicate of the same company in the same
		// re-extraction has no better claim, and picking one keeps the fold stable.
		if (name !== undefined && !foundByName.has(nameKey(name)))
			foundByName.set(nameKey(name), row)
	}
	let filled = 0
	const merged = known.map(row => {
		const name = rowName(row)
		const match =
			name === undefined ? undefined : foundByName.get(nameKey(name))
		if (match === undefined) return row
		const next: Record<string, unknown> = { ...row }
		let filledHere = 0
		for (const key of SCAN_ROW_FIELDS) {
			if (!hasRowValue(row[key]) && hasRowValue(match[key])) {
				next[key] = match[key]
				filledHere++
			}
		}
		filled += filledHere
		return filledHere === 0 ? row : next
	})
	const knownNames = new Set(
		known.flatMap(row => {
			const name = rowName(row)
			return name === undefined ? [] : [nameKey(name)]
		}),
	)
	const additions = found.filter(row => {
		const name = rowName(row)
		return name !== undefined && !knownNames.has(nameKey(name))
	})
	if (filled === 0 && additions.length === 0) {
		return { findings, filled: 0, contactsChanged: false, added: 0 }
	}
	return {
		findings: {
			...(findings as object),
			[field]: [...merged, ...additions],
		},
		filled,
		contactsChanged: false,
		added: additions.length,
	}
}

/**
 * Fold a re-extraction over the enlarged evidence back into the findings.
 *
 * A high-value field is filled only where the first pass left it empty, so a value
 * already grounded is never overwritten. The people come across as well: the pages
 * this round fetched are read by the same passes as any other, so a leader they
 * name has already been found and guarded — dropping them here would mean paying
 * to read a team page and then throwing the team away. Merging keeps whoever was
 * already known, adds anyone new, and fills in a title for someone who had none,
 * so a second look can only ever leave the list better than it found it.
 */
export const mergePerFieldSearch = (
	findings: unknown,
	refreshed: unknown,
	schemaName: string,
): PerFieldMerge => {
	if (isDiscoveryScan(schemaName)) {
		return mergeScanRows(schemaName, findings, refreshed)
	}
	const enrichment = enrichmentOf(findings)
	const refreshedEnrichment = enrichmentOf(refreshed)
	if (enrichment === undefined || refreshedEnrichment === undefined) {
		return { findings, filled: 0, contactsChanged: false, added: 0 }
	}
	let filled = 0
	const nextEnrichment: Record<string, unknown> = { ...enrichment }
	for (const key of HIGH_VALUE_FIELDS) {
		if (!hasValue(enrichment[key]) && hasValue(refreshedEnrichment[key])) {
			nextEnrichment[key] = refreshedEnrichment[key]
			filled++
		}
	}
	const known = contactsOf(findings)
	const found = contactsOf(refreshed)
	const contacts = found.length > 0 ? mergeContacts(known, found) : known
	// A second look adds people, but it also puts a title on somebody already
	// named — and that leaves the list exactly as long as it was. Asking what is
	// in the list rather than how long it is keeps those titles, which are the
	// whole reason for opening a team page.
	const contactsChanged =
		contacts.length !== known.length ||
		contacts.some((contact, index) => contact !== known[index])
	if (filled === 0 && !contactsChanged) {
		return { findings, filled: 0, contactsChanged: false, added: 0 }
	}
	return {
		findings: {
			...(findings as object),
			enrichment: nextEnrichment,
			...(contactsChanged ? { contacts } : {}),
		},
		filled,
		contactsChanged,
		added: 0,
	}
}
