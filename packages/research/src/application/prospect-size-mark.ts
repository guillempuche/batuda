/**
 * Marks the rows of a scan whose stated headcount falls outside the size band
 * the request wrote.
 *
 * The band a caller passes as a filter is enforced by `filterProspectsByCriteria`,
 * which removes. This reads the band the request only wrote — "entre 5 y 250
 * empleados" — and marks instead, because nobody asked for the row to be gone:
 * a reader working the list wants to see the 400-person firm and decide. Like
 * the filter, it acts only on a stated conflict; a row that names no headcount
 * is left alone, since silence is not a finding.
 *
 * Written once, on the final list, by the step that also writes the existence
 * marks: a mark written inside the guard chain is lost when a later round folds
 * the list again.
 */
import { isPlainObject } from './guard-shapes'
import { outsideSizeBand, statedEmployees } from './prospect-criteria-guard'
import type { RequestSize } from './request-parts'
import { MARKS_FIELD, marksOn, OUTSIDE_REQUESTED_SIZE } from './row-marks'

export interface SizeMarkResult {
	readonly findings: unknown
	/** Rows marked on this call; a row already carrying the mark is not counted. */
	readonly marked: number
}

export const markRowsOutsideSize = (
	findings: unknown,
	listField: string | undefined,
	size: RequestSize,
): SizeMarkResult => {
	const hasBand =
		size.minEmployees !== undefined || size.maxEmployees !== undefined
	if (!hasBand || listField === undefined || !isPlainObject(findings))
		return { findings, marked: 0 }
	const rows = findings[listField]
	if (!Array.isArray(rows)) return { findings, marked: 0 }
	let marked = 0
	const nextRows = rows.map(row => {
		if (!isPlainObject(row)) return row
		const employees = statedEmployees(row)
		if (employees === undefined || !outsideSizeBand(employees, size)) return row
		const existingMarks = marksOn(row)
		if (existingMarks.includes(OUTSIDE_REQUESTED_SIZE)) return row
		marked++
		return { ...row, [MARKS_FIELD]: [...existingMarks, OUTSIDE_REQUESTED_SIZE] }
	})
	return marked === 0
		? { findings, marked: 0 }
		: { findings: { ...findings, [listField]: nextRows }, marked }
}
