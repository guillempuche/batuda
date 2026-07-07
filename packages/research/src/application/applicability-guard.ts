/**
 * Drops proposed CRM updates that could never be applied, so the review surface
 * and the apply path are not cluttered with un-actionable suggestions — the model
 * sometimes emits an update for a company that does not exist, or lists column
 * names as a bare string instead of values to write.
 *
 * A proposal survives only when it could actually land:
 *  - its `fields` is a non-empty object of values (a raw string or an empty object
 *    can never be written);
 *  - an update (the default) additionally needs a `subject_id` that resolves to a
 *    real, non-deleted CRM row — the model can invent an id for a made-up company;
 *  - a create carries the whole new row in `fields`, so it needs no subject.
 *
 * `subjectExists` answers whether a (table, id) names a live row; the caller
 * supplies it so this module stays free of a database.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)

export interface ApplicabilityResult {
	readonly findings: unknown
	/** Proposed writes dropped because they could never be applied. */
	readonly dropped: number
}

export const filterApplicableProposals = (
	findings: unknown,
	subjectExists: (subjectTable: string, subjectId: string) => boolean,
): ApplicabilityResult => {
	let dropped = 0

	const isApplicable = (proposal: unknown): boolean => {
		if (!isPlainObject(proposal)) return false
		const { operation, subject_table, subject_id, fields } = proposal
		// Every proposal needs real values to write; the model sometimes emits
		// `fields` as prose or an empty object, neither of which can apply.
		if (!isPlainObject(fields) || Object.keys(fields).length === 0) return false
		// A create carries the new row in `fields` and needs no subject. Anything
		// else is an update, which also needs a subject that resolves to a live
		// row — matching how the apply path treats a missing/unknown operation.
		if (operation === 'create') return true
		if (typeof subject_table !== 'string' || typeof subject_id !== 'string')
			return false
		if (subject_id.trim() === '') return false
		return subjectExists(subject_table, subject_id)
	}

	const walk = (value: unknown, key?: string): unknown => {
		if (Array.isArray(value)) {
			if (key === 'proposed_updates') {
				return value.filter(proposal => {
					const ok = isApplicable(proposal)
					if (!ok) dropped++
					return ok
				})
			}
			return value.map(item => walk(item))
		}
		if (isPlainObject(value)) {
			return Object.fromEntries(
				Object.entries(value).map(([k, v]) => [k, walk(v, k)] as const),
			)
		}
		return value
	}

	return { findings: walk(findings), dropped }
}
