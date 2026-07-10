/**
 * Parses the golden set — the list of companies with a known-correct answer that
 * the eval scores every run against — into the typed `GoldenExpectation` the scorer
 * reads.
 *
 * A row arrives the way the observability platform stores it: the research query as
 * the "input", and the known answer as the "expected output" (arbitrary JSON, which
 * a CSV export hands back as a string). Validation is strict and returns a friendly
 * reason per bad row — a typo in the golden data (a mis-spelled field, a missing
 * official domain) has to fail loudly, because a wrong "correct answer" silently
 * poisons every number the harness reports.
 */

import {
	type GoldenExpectation,
	SCORABLE_FIELDS,
	type ScorableField,
} from './eval-scoring'

/**
 * A raw golden row before validation: an id, the research query (the dataset
 * "input"), and the known-correct answer (the dataset "expected output") as
 * arbitrary JSON or a JSON string.
 */
export interface RawGoldenRow {
	readonly id: string
	readonly query: string
	readonly expectedOutput: unknown
}

export type GoldenParseResult =
	| { readonly ok: true; readonly value: GoldenExpectation }
	| { readonly ok: false; readonly error: string }

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null

// The expected output is a JSON string after a CSV export, or an already-parsed
// object over the API; accept either.
const parseExpectedOutput = (raw: unknown): Record<string, unknown> | null => {
	if (typeof raw === 'string') {
		try {
			return asRecord(JSON.parse(raw))
		} catch {
			return null
		}
	}
	return asRecord(raw)
}

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
	Array.isArray(value) && value.every(item => typeof item === 'string')

/** Validate one raw row into a `GoldenExpectation`, or explain why it can't be. */
export const parseGoldenRow = (row: RawGoldenRow): GoldenParseResult => {
	if (row.query.trim().length === 0) {
		return { ok: false, error: 'query is empty' }
	}
	const answer = parseExpectedOutput(row.expectedOutput)
	if (answer === null) {
		return { ok: false, error: 'expected output is not a JSON object' }
	}

	const officialDomain = answer['officialDomain']
	if (
		typeof officialDomain !== 'string' ||
		officialDomain.trim().length === 0
	) {
		return { ok: false, error: 'expected output has no officialDomain string' }
	}

	const rawAltDomains = answer['altDomains']
	if (rawAltDomains !== undefined && !isStringArray(rawAltDomains)) {
		return { ok: false, error: 'altDomains must be an array of strings' }
	}

	const fields: Partial<Record<ScorableField, string>> = {}
	const rawFields = answer['fields']
	if (rawFields !== undefined) {
		const fieldsRecord = asRecord(rawFields)
		if (fieldsRecord === null) {
			return { ok: false, error: 'fields must be a JSON object' }
		}
		for (const [key, value] of Object.entries(fieldsRecord)) {
			if (!SCORABLE_FIELDS.includes(key as ScorableField)) {
				return {
					ok: false,
					error: `unknown field "${key}" (allowed: ${SCORABLE_FIELDS.join(', ')})`,
				}
			}
			if (typeof value !== 'string') {
				return { ok: false, error: `field "${key}" must be a string` }
			}
			fields[key as ScorableField] = value
		}
	}

	return {
		ok: true,
		value: {
			id: row.id,
			query: row.query,
			officialDomain,
			...(rawAltDomains !== undefined ? { altDomains: rawAltDomains } : {}),
			fields,
		},
	}
}

/**
 * Validate a whole golden set, keeping the good rows and collecting a reason for
 * each bad one — so one malformed row cannot silently drop the whole set.
 */
export const parseGoldenSet = (
	rows: ReadonlyArray<RawGoldenRow>,
): {
	readonly golden: ReadonlyArray<GoldenExpectation>
	readonly errors: ReadonlyArray<{
		readonly id: string
		readonly error: string
	}>
} => {
	const golden: GoldenExpectation[] = []
	const errors: Array<{ id: string; error: string }> = []
	for (const row of rows) {
		const result = parseGoldenRow(row)
		if (result.ok) golden.push(result.value)
		else errors.push({ id: row.id, error: result.error })
	}
	return { golden, errors }
}
