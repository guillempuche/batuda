/**
 * Narrow row shape for a research run summary and the boundary narrower that
 * produces it. The `list` endpoint returns `Schema.Unknown`, so callers
 * runtime-narrow here. Shared by the company research card, the company
 * detail page, and the research inbox.
 */

import { DateTime } from 'effect'

export type ResearchRunRow = {
	readonly id: string
	readonly query: string
	readonly schemaName: string | null
	readonly kind: string
	readonly status: string
	readonly costCents: number
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
			createdAt,
		})
	}
	return out
}
