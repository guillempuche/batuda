/**
 * Narrow row shape for a research run summary and the narrower that produces it.
 * Shared by the company research card, the company detail page, and the research
 * inbox.
 *
 * The `list` endpoint is fully typed, so this is not the boundary check it looks
 * like: what it still earns its place for is turning the decoded date into a
 * plain string for display. Everything else it does is a liability — a row it
 * does not recognise is skipped rather than reported, so a shape that drifts
 * loses rows off the screen silently instead of failing. Reading the typed rows
 * directly is the right end state; it waits on the date formatting those rows
 * feed, which is being changed separately.
 */

import { DateTime } from 'effect'

export type ResearchRunRow = {
	readonly id: string
	readonly query: string
	readonly schemaName: string | null
	readonly kind: string
	readonly status: string
	readonly costCents: number
	// Paid lookups are tallied apart from the cheap work, so a reader that shows
	// only one of the two can report a run that spent money as free.
	readonly paidCostCents: number
	readonly createdAt: string
}

function dateToIsoOrNull(value: unknown): string | null {
	if (typeof value === 'string') return value
	if (DateTime.isDateTime(value)) return DateTime.formatIso(value)
	return null
}

export function narrowResearch(
	rows: ReadonlyArray<unknown>,
): ReadonlyArray<ResearchRunRow> {
	const out: Array<ResearchRunRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['query'] !== 'string') continue
		if (typeof r['status'] !== 'string') continue
		// Typed date fields decode to DateTime.Utc on the wire; accept that form
		// alongside an ISO string.
		const createdAt = dateToIsoOrNull(r['createdAt'])
		if (createdAt === null) continue
		out.push({
			id: r['id'],
			query: r['query'],
			schemaName: typeof r['schemaName'] === 'string' ? r['schemaName'] : null,
			kind: typeof r['kind'] === 'string' ? r['kind'] : 'leaf',
			status: r['status'],
			costCents: typeof r['costCents'] === 'number' ? r['costCents'] : 0,
			paidCostCents:
				typeof r['paidCostCents'] === 'number' ? r['paidCostCents'] : 0,
			createdAt,
		})
	}
	return out
}
