/**
 * Marks a scan row whose evidence is a name off a list and nothing else.
 *
 * A search for a whole market meets pages that print many companies at once — a
 * directory's index of a trade, a market report naming who leads it. Those pages
 * give a name and stop there: no address, no site, nothing about the company beyond
 * its being on the list. A row built from one is a name, and reading the finished
 * answer there is no way to tell it from a row the run actually looked into.
 *
 * Measured on eight live market searches, this marks 15 of 168 French rows and 3 of
 * 167 Spanish ones — eight lift companies lifted off a single directory index
 * whose whole cited quote was "Liste des professionnels · DAMAD · Ascenseurs de
 * Paris · …", and four multinationals off a market report's sentence about who leads
 * the trade. None carried a site, a place, or a mark of any kind.
 *
 * The mark is what already exists for this: the evidence names the company but does
 * not establish that it exists and trades. Nothing was inventing anything — there
 * was simply no more to be had from the page — so this says so rather than trying to
 * fill the blanks, which on a name alone could only be guesswork.
 *
 * Three things together say a row is that:
 *  - no site of its own, so there is nowhere to go and read more;
 *  - no place, so it cannot even be put on a map;
 *  - nothing cited that is about this company alone — every page it cites, this run
 *    also cited for some other company, which is what a page listing many companies
 *    looks like from here. A row citing nothing at all is the same case, more so.
 *
 * All three, because each alone is ordinary. A real company can go without a site,
 * and a row off a shared page can still carry the address printed beside its name —
 * the Spanish lists are full of both. It is the three together that leave a name.
 *
 * Runs after the mark is taken back off rows that only read their own blanks back,
 * so that step cannot undo this one. See `unconfirmed-mark-guard.ts` — it clears a
 * reason built from field names, and this deliberately says nothing about fields.
 */

import { isPlainObject, readTextValue } from './guard-shapes'

/** What this leaves on a row, for the reader to be told in their own language. */
export const NAME_ONLY_EVIDENCE = 'name_only_listing'

/**
 * The key it is left under. Named so the de-duplication fold can recognise it as
 * a finding about one meeting of a company rather than a fact about the company,
 * and leave it behind when two rows become one.
 */
export const NAME_ONLY_EVIDENCE_FIELD = 'unconfirmed_evidence'

export interface NameOnlyResult {
	readonly findings: unknown
	/** How many rows were marked, for the run's own telemetry. */
	readonly marked: number
}

/**
 * A field that holds something, as opposed to being absent or blank. A null counts
 * as absent: a model writing `"website": null` is saying it has none, and reading
 * that as a site would let the very rows this looks for slip past unmarked.
 *
 * Both fields this reads are now paired with the page they were read on, and an
 * emptied pairing is as absent as a missing field — otherwise a guard upstream
 * taking a made-up place away would leave a wrapper behind that still counted as
 * a place, and the row would go on looking better for having had one.
 */
const isFilled = (value: unknown): boolean => readTextValue(value) !== null

/** The pages one row cites, without repeats. */
const citedPages = (row: Record<string, unknown>): ReadonlySet<string> => {
	const citations = row['citations']
	if (!Array.isArray(citations)) return new Set()
	const pages = new Set<string>()
	for (const citation of citations) {
		if (!isPlainObject(citation)) continue
		const page = citation['source_id']
		if (typeof page === 'string' && page.trim() !== '') pages.add(page.trim())
	}
	return pages
}

/**
 * Mark the rows of one discovery scan that are a name off a list.
 *
 * A row already carrying doubt is left as it is: the run said something about that
 * company in its own words, and replacing it with this would say less.
 */
export const markNameOnlyRows = (
	findings: unknown,
	listField: string | undefined,
): NameOnlyResult => {
	if (listField === undefined) return { findings, marked: 0 }
	if (!isPlainObject(findings)) return { findings, marked: 0 }
	const rows = findings[listField]
	if (!Array.isArray(rows)) return { findings, marked: 0 }

	// How many rows of this answer each page was cited for. A page cited for one row
	// is evidence about that company; a page cited for several is a list of them.
	const rowsPerPage = new Map<string, number>()
	for (const row of rows) {
		if (!isPlainObject(row)) continue
		for (const page of citedPages(row)) {
			rowsPerPage.set(page, (rowsPerPage.get(page) ?? 0) + 1)
		}
	}

	let marked = 0
	const kept = rows.map(row => {
		if (!isPlainObject(row)) return row
		if (isFilled(row['unconfirmed_reason'])) return row
		if (isFilled(row['website']) || isFilled(row['location'])) return row
		const pages = citedPages(row)
		const ownPage = [...pages].some(page => (rowsPerPage.get(page) ?? 0) < 2)
		if (ownPage) return row
		marked += 1
		return { ...row, unconfirmed_evidence: NAME_ONLY_EVIDENCE }
	})

	return marked === 0
		? { findings, marked: 0 }
		: { findings: { ...findings, [listField]: kept }, marked }
}
