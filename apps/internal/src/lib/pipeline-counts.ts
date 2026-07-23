// Companies nobody is working any more — either won and handed over, or ruled
// out. They still appear in the pipeline strip, but they are not active work.
const CLOSED_STATUSES = new Set<string>(['closed', 'dead'])

/**
 * How many companies are still being worked, counted from the pipeline
 * snapshot's per-status totals. The snapshot counts the whole pipeline, so
 * this holds for an organization of any size — unlike a loaded list, which
 * stops at the page it fetched.
 */
export function countActiveCompanies(
	statusCounts: Readonly<Record<string, number>>,
): number {
	let total = 0
	for (const [status, count] of Object.entries(statusCounts)) {
		if (!CLOSED_STATUSES.has(status)) total += count
	}
	return total
}

/** Same count for a list of companies already in hand. */
export function countActiveIn(
	companies: ReadonlyArray<{ readonly status: string }>,
): number {
	return companies.filter(company => !CLOSED_STATUSES.has(company.status))
		.length
}
