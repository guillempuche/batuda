/**
 * Narrow row shape for a research run summary and the boundary narrower that
 * produces it. The `list` endpoint returns `Schema.Unknown`, so callers
 * runtime-narrow here. Shared by the company research card, the company
 * detail page, and the research inbox.
 */

export type ResearchRunRow = {
	readonly id: string
	readonly query: string
	readonly schemaName: string | null
	readonly kind: string
	readonly status: string
	readonly costCents: number
	readonly createdAt: string
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
		const createdAt = r['createdAt']
		if (typeof createdAt !== 'string') continue
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
