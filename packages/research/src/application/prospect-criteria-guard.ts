/**
 * Drops prospects that miss a size or place the request actually asked for.
 *
 * Asked for midsize companies in one country, an open-ended search will happily
 * hand back a ranking of the sector's giants somewhere else — the page it found is
 * about the right industry, so nothing upstream objects. The prompt asks the model
 * to honor the request's qualifiers; this is the part that does not depend on it
 * having listened.
 *
 * It drops only on a stated conflict. A prospect that never says how many people it
 * employs, or where it is, is kept: this removes what is provably wrong, never what
 * is merely unproven, and dropping on silence would turn a thin list into an empty
 * one. `criteria` come from the caller, so this module needs to know nothing about
 * how a request is worded or stored.
 */

import { parseCountryAlpha2 } from '../domain/country'

// A country read as a canonical two-letter code, or nothing when it is not clearly
// a country. Both the request's countries and a prospect's stated country pass
// through here, so the two are always compared the same way: "UK" and "GB" name the
// same place, and a full name or three-letter code the model wrote instead of a code
// (`Spain`, `ESP`) yields nothing — which, on the stated side, reads as "not stated"
// and keeps the prospect. The filter never drops on a place it could not pin down.
const canonicalCountry = (raw: string | undefined): string | undefined => {
	const code = parseCountryAlpha2(raw)
	if (code === undefined) return undefined
	return code === 'UK' ? 'GB' : code
}

export interface ProspectCriteria {
	/** Fewest employees the request asked for, if it set a floor. */
	readonly minEmployees?: number | undefined
	/** Most employees the request asked for, if it set a ceiling. */
	readonly maxEmployees?: number | undefined
	/** Countries the request confined the search to; empty or absent means anywhere. */
	readonly countries?: ReadonlyArray<string> | undefined
}

export interface ProspectCriteriaResult {
	readonly findings: unknown
	/** Prospects dropped for stating a size or place the request ruled out. */
	readonly dropped: number
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)

// A prospect's stated headcount, if it gave one that reads as a real number. The
// field pairs the number with the source that backs it, so the number is one level
// in; a value the guard chain already blanked to null reads as "not stated".
const statedEmployees = (
	prospect: Record<string, unknown>,
): number | undefined => {
	const field = prospect['employee_estimate']
	if (!isPlainObject(field)) return undefined
	const value = field['value']
	return typeof value === 'number' ? value : undefined
}

// A prospect's stated country as a canonical code, or "not stated" when it is absent
// or written as something we cannot pin to a country.
const statedCountry = (
	prospect: Record<string, unknown>,
): string | undefined => {
	const country = prospect['country']
	return typeof country === 'string' ? canonicalCountry(country) : undefined
}

export const filterProspectsByCriteria = (
	findings: unknown,
	criteria: ProspectCriteria,
): ProspectCriteriaResult => {
	const hasSize =
		criteria.minEmployees !== undefined || criteria.maxEmployees !== undefined
	// Canonicalize the wanted countries the same way a prospect's stated one is, so
	// "GB" and "UK" match and a name we cannot resolve simply drops from the set —
	// leaving nothing to filter on rather than ruling every prospect out.
	const wantedCountries = new Set(
		(criteria.countries ?? [])
			.map(canonicalCountry)
			.filter((code): code is string => code !== undefined),
	)
	const hasCountries = wantedCountries.size > 0
	// Nothing to hold a prospect to: hand the findings back untouched.
	if (!hasSize && !hasCountries) return { findings, dropped: 0 }

	// A prospect is ruled out only when what it states clashes with the request.
	const conflicts = (prospect: unknown): boolean => {
		if (!isPlainObject(prospect)) return false
		const employees = statedEmployees(prospect)
		if (employees !== undefined) {
			if (
				criteria.minEmployees !== undefined &&
				employees < criteria.minEmployees
			)
				return true
			if (
				criteria.maxEmployees !== undefined &&
				employees > criteria.maxEmployees
			)
				return true
		}
		const country = statedCountry(prospect)
		if (hasCountries && country !== undefined && !wantedCountries.has(country))
			return true
		return false
	}

	let dropped = 0
	const walk = (value: unknown, key?: string): unknown => {
		if (Array.isArray(value)) {
			if (key === 'prospects') {
				return value.filter(prospect => {
					const ruledOut = conflicts(prospect)
					if (ruledOut) dropped++
					return !ruledOut
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

/** The size and place a run's stored hints amount to; empty when it asked for none. */
export const prospectCriteriaFromHints = (
	hints:
		| {
				min_employees?: number
				max_employees?: number
				minEmployees?: number
				maxEmployees?: number
		  }
		| undefined,
	countries: ReadonlyArray<string>,
): ProspectCriteria => ({
	// The stored hints round-trip through a camelCasing transform, so a value may
	// arrive under either spelling.
	minEmployees: hints?.minEmployees ?? hints?.min_employees,
	maxEmployees: hints?.maxEmployees ?? hints?.max_employees,
	countries,
})
