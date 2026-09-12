import { Effect } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'

import {
	canonicalizeUrl,
	isWebAddress,
	sourceIdFor,
	urlHashForScrape,
} from '@batuda/research'

// Where a value a research run found came from, and how a run's own name for a
// page is turned into the page's real address. Used by every door that lands a
// run's values on a row: the apply path for proposed updates, and the company
// writes that carry attribute values a scan read.

// What the run cited for one value: which page it read the value on, how sure it
// was, and the date the value was true as of. The page is named by the run's own
// id for it, which only means something inside that run.
export type FieldCitation = {
	readonly sourceId: string
	readonly confidence?: number
	readonly asOf?: string
}

// Where one applied value came from, as the company row keeps it: the page's own
// address rather than the run's private id for it, plus the run that read it.
// Stored beside the value it explains, so a reader can ask "where did this come
// from?" of any single fact on the row.
export type FieldSource = {
	readonly sourceUrl: string
	readonly runId: string
	readonly confidence?: number
	readonly asOf?: string
}

// Every way one of a run's pages can be named, each pointing at the one address
// on file.
export type RunPages = ReadonlyMap<string, string>

/**
 * The pages one run fetched, keyed by every name the run might use for each. A
 * run names a page either by its address — which is what the model is asked
 * for, and all it is ever shown — or by the id we hold that page under, which
 * is what our own harvested values carry. Read once per call, then asked as
 * often as there are values to place.
 *
 * Only pages THIS run fetched are here: the page store is shared by every
 * organisation, so it is the run's own link rows that hold this to pages this
 * run really opened. Take that join away and an address a run merely mentioned
 * would resolve against somebody else's page.
 */
export const readRunPages = (sql: SqlClient.SqlClient, runId: string) =>
	Effect.map(
		sql<{ id: string; url: string; localRef: string }>`
			SELECT s.id, s.url, rs.local_ref AS "localRef"
			FROM research_run_sources rs
			JOIN sources s ON s.id = rs.source_id
			WHERE rs.research_id = ${runId}
			ORDER BY s.id
		`,
		(rows): RunPages => {
			// What gets stored is always the address on file, never the text the run
			// happened to write down. Two pages can tidy down to the same name and
			// the first of them wins, so the rows are read in a fixed order — the
			// same citation then always resolves to the same page.
			const urlByName = new Map<string, string>()
			for (const row of rows) {
				// A page with no address on file cannot be pointed at, so it never
				// becomes a way of naming one. Left in, it would answer a lookup with
				// an empty string — a found value as far as the search below is
				// concerned — and store a note leading nowhere.
				if (row.url === '') continue
				for (const name of [
					row.id,
					canonicalizeUrl(row.url),
					canonicalizeUrl(row.localRef),
				])
					if (!urlByName.has(name)) urlByName.set(name, row.url)
			}
			return urlByName
		},
	)

/**
 * The page a citation names, among a run's pages, or nothing when the run never
 * opened it. Exactly as written first, so an id we minted is never put through
 * address-tidying it was never meant for. Then the tidied address. Then the id
 * that address itself maps to, which is what still finds the page when a fetch
 * was redirected off-site and the row kept where it landed. That last one only
 * makes sense for an address: asked of an id it would hash the id itself, which
 * names no page anybody holds.
 */
export const pageFor = (
	pages: RunPages,
	sourceId: string,
): string | undefined =>
	pages.get(sourceId) ??
	pages.get(canonicalizeUrl(sourceId)) ??
	(isWebAddress(sourceId)
		? pages.get(sourceIdFor(urlHashForScrape(sourceId)))
		: undefined)

/**
 * Swap each cited page for the page's real address, and stamp the run that cited
 * it. A citation naming a page the run never opened is dropped, because a stored
 * note about where a fact came from has to point somewhere a reader can open.
 */
const resolveCitations = (
	pages: RunPages,
	runId: string,
	citations: Record<string, FieldCitation>,
): Record<string, FieldSource> =>
	Object.fromEntries(
		Object.entries(citations).flatMap(([field, cited]) => {
			const sourceUrl = pageFor(pages, cited.sourceId)
			if (sourceUrl === undefined) return []
			const source: FieldSource = {
				sourceUrl,
				runId,
				...(cited.confidence !== undefined
					? { confidence: cited.confidence }
					: {}),
				...(cited.asOf !== undefined ? { asOf: cited.asOf } : {}),
			}
			return [[field, source]]
		}),
	)

// The two steps as one, for a caller with a single set of citations to place.
export const resolveFieldSources = (
	sql: SqlClient.SqlClient,
	runId: string,
	citations: Record<string, FieldCitation>,
) =>
	Object.keys(citations).length === 0
		? Effect.succeed({} as Record<string, FieldSource>)
		: Effect.map(readRunPages(sql, runId), pages =>
				resolveCitations(pages, runId, citations),
			)
