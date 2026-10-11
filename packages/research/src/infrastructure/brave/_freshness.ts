// Brave's freshness takes discrete buckets (past day, week, month, year), never
// a "past N days" number, so the requested window maps to the nearest bucket.
export const freshnessForRecency = (days: number): string =>
	days <= 1 ? 'pd' : days <= 7 ? 'pw' : days <= 31 ? 'pm' : 'py'
