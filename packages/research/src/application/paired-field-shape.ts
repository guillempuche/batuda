/**
 * Put every field that carries its own evidence into the one shape a reader expects.
 *
 * A few fields on a company a scan found are declared as the value together with
 * the page it was read on — `{ value, source_id, quote }` — rather than as the
 * value on its own. `location` reaches storage as a plain string all the same in
 * most runs: several guards write a field back "in the shape it arrived in", and
 * one of them writes a plain string when neither side of a fold carried the pair.
 * A reader then finds a string on one run and an object on the next, and anything
 * reaching for `.value` quietly finds nothing at all.
 *
 * Chasing each writer would fix today's and miss the next one, so the shape is
 * settled once — after the last guard, before the findings are stored. A value
 * that arrives bare keeps its value and gains no evidence: it is wrapped with no
 * `source_id`, because there is no page to name and putting one there would turn
 * a missing citation into a false one.
 *
 * This settles the shape a row is STORED in, which is the shape the per-field
 * checks grade. What a reader is handed is settled separately and the other way
 * round, in `findings-for-readers.ts`: the value under its own name, with the
 * page beside it. The two are not in tension — a check needs the pair, and a
 * reader wants the value — but a field the schema pairs belongs in the list
 * below as well, or in neither.
 */

/**
 * The fields each kind of scan declares as a value paired with its page.
 *
 * Deliberately not read off the schema: the schema describes what the model is
 * asked for, and this describes what has to be true of a stored row, which is a
 * promise to whoever reads it. A field added to one belongs in the other.
 */
const PAIRED_FIELDS_BY_SCHEMA: Record<string, ReadonlyArray<string>> = {
	prospect_scan_v1: [
		'website',
		'location',
		'employee_estimate',
		'tax_id',
		'industry',
	],
	competitor_scan_v1: ['website'],
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

// A value written on its own, with no page beside it. A number counts: a
// headcount reaches some rows as the figure alone.
const isBareValue = (value: unknown): value is string | number =>
	(typeof value === 'string' && value.trim() !== '') ||
	(typeof value === 'number' && Number.isFinite(value))

export interface PairedFieldResult {
	readonly findings: unknown
	/** How many fields had to be put back into the paired shape. */
	readonly wrapped: number
}

/**
 * Settle the paired fields on every company a scan found.
 *
 * `listField` is the key holding that list, as the schema names it; without one
 * there is no list to walk and the findings pass through untouched.
 */
export const settlePairedFields = (
	findings: unknown,
	schemaName: string,
	listField: string | undefined,
): PairedFieldResult => {
	const fields = PAIRED_FIELDS_BY_SCHEMA[schemaName]
	if (fields === undefined || listField === undefined)
		return { findings, wrapped: 0 }
	if (!isPlainObject(findings)) return { findings, wrapped: 0 }
	const rows = findings[listField]
	if (!Array.isArray(rows)) return { findings, wrapped: 0 }

	let wrapped = 0
	const settled = rows.map(row => {
		if (!isPlainObject(row)) return row
		let changed = false
		const next: Record<string, unknown> = { ...row }
		for (const field of fields) {
			const value = next[field]
			if (!isBareValue(value)) continue
			next[field] = { value }
			changed = true
			wrapped++
		}
		return changed ? next : row
	})

	return wrapped === 0
		? { findings, wrapped: 0 }
		: { findings: { ...findings, [listField]: settled }, wrapped }
}
