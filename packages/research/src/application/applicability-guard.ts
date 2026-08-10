/**
 * Drops proposed CRM updates that could never be applied, so the review surface
 * and the apply path are not cluttered with un-actionable suggestions — the model
 * sometimes emits an update for a company that does not exist, or lists column
 * names as a bare string instead of values to write.
 *
 * A proposal survives only when it could actually land:
 *  - its `fields` is a non-empty object of values (a raw string or an empty object
 *    can never be written);
 *  - a field holding nothing is taken out first. An earlier check empties a field
 *    whose value it finds no support for, and this runs after those, so what
 *    arrives here is a field the run wanted to write and then could not stand
 *    behind. Left in, accepting the suggestion would erase what the record already
 *    holds — the opposite of what the run was for. A proposal emptied of every
 *    field this way is dropped whole;
 *  - an update (the default) additionally needs a `subject_id` that resolves to a
 *    real, non-deleted CRM row — the model can invent an id for a made-up company;
 *  - a create carries the whole new row in `fields`, so it needs no subject of its
 *    own — but only a person can be created, and a person has to belong to a
 *    company, so a create that names any other table or leaves the company out
 *    could never land either.
 *
 * `subjectExists` answers whether a (table, id) names a live row; the caller
 * supplies it so this module stays free of a database.
 */

import { isPlainObject, unwrapValue } from './guard-shapes'

export interface ApplicabilityResult {
	readonly findings: unknown
	/** Proposed writes dropped because they could never be applied. */
	readonly dropped: number
	/** Individual fields taken out of a surviving proposal for holding nothing. */
	readonly emptiedFields: number
}

// A field holds something worth writing when it is neither absent nor emptied. An
// earlier check replaces a value it cannot support with nothing at all, and a field
// in that state must not travel on: writing it would clear what the record holds.
const holdsAValue = (value: unknown): boolean => {
	if (value === null || value === undefined) return false
	// The per-field shape a value travels in — a value with the page it came from.
	// The same rule applies one level in, since that is where a check empties it.
	if (isPlainObject(value) && 'value' in value) {
		const inner = value['value']
		return inner !== null && inner !== undefined
	}
	return true
}

export const filterApplicableProposals = (
	findings: unknown,
	subjectExists: (subjectTable: string, subjectId: string) => boolean,
): ApplicabilityResult => {
	let dropped = 0
	let emptiedFields = 0

	// Take out the fields holding nothing, so what the checks below judge is what
	// would actually be written.
	const withoutEmptyFields = (proposal: unknown): unknown => {
		if (!isPlainObject(proposal)) return proposal
		const fields = proposal['fields']
		if (!isPlainObject(fields)) return proposal
		const kept = Object.entries(fields).filter(([, value]) =>
			holdsAValue(value),
		)
		if (kept.length === Object.keys(fields).length) return proposal
		emptiedFields += Object.keys(fields).length - kept.length
		return { ...proposal, fields: Object.fromEntries(kept) }
	}

	const isApplicable = (proposal: unknown): boolean => {
		if (!isPlainObject(proposal)) return false
		const { operation, subject_table, subject_id, fields } = proposal
		// Every proposal needs real values to write; the model sometimes emits
		// `fields` as prose or an empty object, neither of which can apply.
		if (!isPlainObject(fields) || Object.keys(fields).length === 0) return false
		// A create carries the new row in `fields` and needs no subject of its own,
		// but it is only ever a person, and a person belongs to a company. Held to
		// that here so a create naming the wrong table, or naming no company, is
		// dropped now rather than surviving every check and failing in front of
		// whoever clicks accept.
		if (operation === 'create') {
			if (subject_table !== 'contacts') return false
			// Read through a wrapper: a run is asked to pair a changed value with the
			// page it came from, and it tends to wrap the company here too. Wrapped,
			// the id is not a string, and the person would be dropped for belonging
			// to nobody.
			const companyId = unwrapValue(fields['company_id'] ?? fields['companyId'])
			return typeof companyId === 'string' && companyId.trim() !== ''
		}
		// Anything else is an update, which also needs a subject that resolves to a
		// live row — matching how the apply path treats a missing/unknown operation.
		if (typeof subject_table !== 'string' || typeof subject_id !== 'string')
			return false
		if (subject_id.trim() === '') return false
		return subjectExists(subject_table, subject_id)
	}

	const walk = (value: unknown, key?: string): unknown => {
		if (Array.isArray(value)) {
			if (key === 'proposed_updates') {
				return value.map(withoutEmptyFields).filter(proposal => {
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

	return { findings: walk(findings), dropped, emptiedFields }
}
