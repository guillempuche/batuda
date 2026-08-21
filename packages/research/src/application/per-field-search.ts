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
import { isPlainObject, isValueWrapper, unwrapValue } from './guard-shapes'
import {
	dedupeDiscoveryRows,
	discoveryRowIdentityKeys,
	hostsEstablishedAsOwn,
	isSiteKey,
} from './prospect-dedupe-guard'
import type { RunWords } from './run-words'

// The company-profile facts worth spending an extra search on. `size_range` is
// also nudged during the loop (headcount is rarely on the homepage); for the
// other three this step is the only search that goes looking for them.
export const HIGH_VALUE_FIELDS: ReadonlyArray<string> = [
	'country',
	'industry',
	'location',
	'size_range',
]

// The facts worth an extra search on one company a scan found, per kind of scan.
// A scan is asked for a list to work through, and a name alone cannot be worked
// with: the site is how someone reaches the company, and the headcount is how
// they decide whether it is worth reaching.
//
// Each field named here has to exist on that scan's own schema, or the search is
// paid for and the answer has nowhere to land — a competitor is never asked for a
// headcount, so asking the web for one would buy nothing. The test next door
// checks each name against the real schema so the two cannot drift apart. This
// list also decides what a wider read is allowed to fill in, so a field left out
// of it is one whose value is thrown away even when a round does turn it up.
//
// Listed in the order they are worth going after, since a round's cap can cut the
// list short.
const SCAN_ROW_FIELDS_BY_SCHEMA: Record<string, ReadonlyArray<string>> = {
	prospect_scan_v1: ['website', 'employee_estimate', 'location'],
	competitor_scan_v1: ['website'],
}

/** The facts worth searching for on one company this kind of scan found. */
export const scanRowFields = (schemaName: string): ReadonlyArray<string> =>
	SCAN_ROW_FIELDS_BY_SCHEMA[schemaName] ?? []

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
	return rows.filter(isPlainObject)
}

/** The name a scan row goes by, or undefined when it names no company. */
const rowName = (row: Record<string, unknown>): string | undefined => {
	const name = (row as { name?: unknown }).name
	return typeof name === 'string' && name.trim() !== ''
		? name.trim()
		: undefined
}

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
			for (const field of scanRowFields(args.schemaName)) {
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
	/**
	 * How many companies the list gained — not how many rows were appended. A row
	 * naming a company already on the list joins it instead of lengthening the
	 * list, and has found nobody.
	 */
	readonly added: number
	/**
	 * How many companies went into this fold and did not come out as a row of
	 * their own, other than by carrying a name the list already held. Usually none.
	 *
	 * Not a count of mistakes — a round that fills in the site showing two listed
	 * companies were always one folds a row away for a good reason. It is reported
	 * because nothing else shows the opposite case: a company a round found, taken
	 * for one already listed on a website belonging to neither, and gone from the
	 * answer with nothing said. The duplicate figure cannot show that, since a row
	 * that was dropped is not a duplicate.
	 *
	 * A round that re-reads companies already listed is not counted, however many
	 * it re-reads: they meet by name, which is the ordinary case and the reason
	 * the rounds run at all.
	 */
	readonly folded: number
}

/**
 * Fold a re-extraction over the enlarged evidence back into a scan's list.
 *
 * A company already found keeps everything it already had — a second look may only
 * fill a blank, and never overwrite a grounded value. A company the re-extraction
 * names that the first pass did not is appended: the enlarged evidence is a wider
 * read of the same question, so what it turns up is a find rather than a
 * contradiction.
 *
 * The list can still come back shorter, and only ever for one reason: two rows of it
 * turn out to be one company. That is a company written twice becoming a company
 * written once, never a company dropped.
 */
const mergeScanRows = (
	schemaName: string,
	findings: unknown,
	refreshed: unknown,
	runWords: RunWords,
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
		return { findings, filled: 0, contactsChanged: false, added: 0, folded: 0 }
	}
	// Rows are matched on what identifies the company — its name with the legal
	// form off the end, or its site — not on the name as written. A second look
	// meets a company through a register or a directory, which prints the fuller
	// legal name, so matching the name as written files it as somebody new: the
	// list grows a second copy instead of the first copy gaining what the round
	// went looking for.
	//
	// Who owns which site is read off both sides at once. A round meets a company
	// under a name that does not spell its domain while the list already holds it
	// under one that does — and asking each side on its own would leave the site
	// speaking for the row that has it and silent for the row that needs it.
	const ownSiteHosts = hostsEstablishedAsOwn([...known, ...found], runWords)
	const foundByKey = new Map<string, Record<string, unknown>>()
	for (const row of found) {
		// First mention wins: a later duplicate of the same company in the same
		// re-extraction has no better claim, and picking one keeps the fold stable.
		for (const key of discoveryRowIdentityKeys(row, ownSiteHosts)) {
			if (!foundByKey.has(key)) foundByKey.set(key, row)
		}
	}
	let filled = 0
	const merged = known.map(row => {
		const match = discoveryRowIdentityKeys(row, ownSiteHosts)
			.map(key => foundByKey.get(key))
			.find(found => found !== undefined)
		if (match === undefined) return row
		const next: Record<string, unknown> = { ...row }
		let filledHere = 0
		for (const key of scanRowFields(schemaName)) {
			if (!hasRowValue(row[key]) && hasRowValue(match[key])) {
				next[key] = match[key]
				filledHere++
			}
		}
		filled += filledHere
		return filledHere === 0 ? row : next
	})
	// Grows as companies are taken, so one re-extraction naming the same new
	// company twice appends it once. A duplicate would not only read badly — the
	// list's length is what decides whether a scan came back too thin to trust,
	// so counting one company twice can pass a scan off as healthier than it is.
	const taken = new Set(
		known.flatMap(row => discoveryRowIdentityKeys(row, ownSiteHosts)),
	)
	// Companies this round named that a site alone joined to one already listed.
	// Counted here because this is where such a row stops being a row: it is not
	// appended, and no later step sees it to fold or to report.
	let joinedOnSite = 0
	const additions = found.filter(row => {
		// Matching an existing company takes any of the keys; becoming a new row in
		// the list takes a name. A company nobody can name is one nobody can work
		// with, whatever else is known about it.
		if (rowName(row) === undefined) return false
		const keys = discoveryRowIdentityKeys(row, ownSiteHosts)
		const metOn = keys.filter(key => taken.has(key))
		if (metOn.length > 0) {
			// A round re-reading a company it already found meets it by name, which
			// is the ordinary case and says nothing. A round whose company only ever
			// met a listed one through a website is the case worth watching.
			if (metOn.every(isSiteKey)) joinedOnSite++
			return false
		}
		for (const key of keys) taken.add(key)
		return true
	})
	if (filled === 0 && additions.length === 0) {
		return {
			findings,
			filled: 0,
			contactsChanged: false,
			added: 0,
			folded: joinedOnSite,
		}
	}
	// This round has just moved the ground under the fold that ran before the rounds
	// began: it appends companies that fold never saw, and fills in the website of a
	// row that had none. Two rows that looked nothing alike then can be one company
	// now — the same site under two spellings of the name, or a branch office found
	// on a later page. Folding here, rather than once when the rounds are over, is
	// what keeps that from depending on where a call sits: the step that disturbs
	// the list is the step that settles it, so nothing later has to remember to.
	const settle = (rows: ReadonlyArray<unknown>): number | undefined => {
		const held = (
			dedupeDiscoveryRows(
				{ ...(findings as object), [field]: rows },
				field,
				runWords,
			).findings as Record<string, unknown>
		)[field]
		return Array.isArray(held) ? held.length : undefined
	}
	const settled = dedupeDiscoveryRows(
		{ ...(findings as object), [field]: [...merged, ...additions] },
		field,
		runWords,
	)
	const held = (settled.findings as Record<string, unknown>)[field]
	// What the list gained, counted in companies rather than rows. A row that joined
	// a company already on the list is not a find, and calling it one would buy
	// another paid round of searches for somebody no reader ever sees.
	//
	// Measured against the rows already held, folded on their own, rather than
	// against how many there were. This round can also have filled in the website
	// that shows two companies already on the list were always one — that shortens
	// it for a reason that is not a find, and letting it count against the gain
	// would report a real find as nothing and stop the rounds a round early.
	const before = settle(merged)
	const after = Array.isArray(held) ? held.length : undefined
	return {
		findings: settled.findings,
		filled,
		contactsChanged: false,
		added:
			before === undefined || after === undefined
				? additions.length
				: Math.max(0, after - before),
		// The companies a site joined to one already listed, plus the rows this fold
		// then joined to another — rows in, less rows out. A company the round
		// simply did not name again is not in either: it stays on the list.
		folded:
			joinedOnSite +
			(after === undefined
				? 0
				: Math.max(0, merged.length + additions.length - after)),
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
	runWords: RunWords,
): PerFieldMerge => {
	if (isDiscoveryScan(schemaName)) {
		return mergeScanRows(schemaName, findings, refreshed, runWords)
	}
	const enrichment = enrichmentOf(findings)
	const refreshedEnrichment = enrichmentOf(refreshed)
	if (enrichment === undefined || refreshedEnrichment === undefined) {
		return { findings, filled: 0, contactsChanged: false, added: 0, folded: 0 }
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
		return { findings, filled: 0, contactsChanged: false, added: 0, folded: 0 }
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
		folded: 0,
	}
}
