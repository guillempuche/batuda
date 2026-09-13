/**
 * Where a pass's report is filed and what a filed copy is allowed to hold.
 *
 * A baseline is kept so a later pass can be read against it — the rates it
 * measured, and what one run cost, which is how the free pre-flight prices the
 * next pass from a real figure rather than a guess. What a run *found* is not
 * part of that: the pages, the quotes and the values belong to the companies
 * the set names, and a committed file is the one place they must not end up.
 *
 * Everything here is pure so the rules can be tested without a pass, a clock or
 * a filesystem.
 */

import type { EvalReport } from './eval-report'
import type { RunScore } from './eval-scoring-types'

/** The golden set a pass measured, as the folder name its baselines live under. */
export const goldenStem = (goldenPath: string): string => {
	const base = goldenPath.split('/').pop() ?? goldenPath
	return base.endsWith('.json') ? base.slice(0, -'.json'.length) : base
}

/**
 * What a baseline copy is called: the day and time it was taken and the commit
 * it was taken on, so any pass can be traced back to the code that produced it
 * and a second pass on the same commit does not land on the first one's name.
 *
 * `nogit` stands in where the commit cannot be read — a tarball, a checkout with
 * no version control — because a baseline nobody can trace is still worth more
 * than none.
 */
export const baselineReportName = (
	isoTimestamp: string,
	shortSha: string | null,
): string => {
	const day = isoTimestamp.slice(0, 10)
	const time = isoTimestamp.slice(11, 16).replace(':', '')
	return `${day}-${time}-${shortSha ?? 'nogit'}.json`
}

/**
 * The newest report in a baselines folder, by name. The names start with the day
 * and time they were taken, so sorting them is sorting by when — no file has to
 * be opened, and a stray file that is not a report is passed over rather than
 * read and found unrecognisable.
 */
export const newestReportName = (
	names: ReadonlyArray<string>,
): string | null => {
	const reports = names.filter(name => name.endsWith('.json'))
	if (reports.length === 0) return null
	return [...reports].sort((a, b) => b.localeCompare(a))[0] ?? null
}

/** A run's score with what it found taken out. */
export type BaselineRunScore = Omit<RunScore, 'fields'>

/** A filed report: every rate, and not one thing a run read off a page. */
export interface BaselineReport {
	readonly summary: EvalReport['summary']
	readonly runs: ReadonlyArray<BaselineRunScore>
	readonly byBucket: EvalReport['byBucket']
	readonly byCountry: EvalReport['byCountry']
	readonly byMarket: EvalReport['byMarket']
}

/**
 * The report as it may be committed: the rates and the tables whole, and every
 * run stripped of `fields` — the one place a run's score carries what it read
 * off a company's pages rather than a count of how it did.
 */
export const stripReportForBaseline = (report: EvalReport): BaselineReport => ({
	summary: report.summary,
	runs: report.runs.map(({ fields: _fields, ...rest }) => rest),
	byBucket: report.byBucket,
	byCountry: report.byCountry,
	byMarket: report.byMarket,
})
