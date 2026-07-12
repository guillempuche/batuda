/**
 * Parses the contact golden set — companies with their known decision-makers —
 * into the typed ContactGoldenExpectation the scorer reads. Validation is strict
 * and returns a friendly reason per bad row: a fabricated or malformed "known
 * contact" silently poisons recall and precision, so a bad row must fail loudly
 * rather than quietly skew the numbers the vendor decision rests on.
 */

import type {
	ContactGoldenExpectation,
	GoldenContact,
} from './eval-contacts-scoring'

/**
 * A raw golden row before validation: the company (name + domain + optional
 * country) and its known contacts as arbitrary JSON.
 */
export interface RawContactGoldenRow {
	readonly id: string
	readonly companyName: string
	readonly domain: string
	readonly country?: string
	readonly expectedContacts: unknown
}

export type ContactGoldenParseResult =
	| { readonly ok: true; readonly value: ContactGoldenExpectation }
	| { readonly ok: false; readonly error: string }

const nonEmptyString = (value: unknown): value is string =>
	typeof value === 'string' && value.trim().length > 0

// Validate one contact into a GoldenContact, or return why it can't be.
const parseContact = (raw: unknown): GoldenContact | string => {
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
		return 'a contact is not an object'
	}
	const record = raw as Record<string, unknown>
	if (!nonEmptyString(record['name'])) return 'a contact has no name'
	if (record['role'] !== undefined && typeof record['role'] !== 'string') {
		return 'a contact role must be a string'
	}
	if (record['email'] !== undefined && typeof record['email'] !== 'string') {
		return 'a contact email must be a string'
	}
	return {
		name: record['name'],
		...(typeof record['role'] === 'string' ? { role: record['role'] } : {}),
		...(typeof record['email'] === 'string' ? { email: record['email'] } : {}),
	}
}

/** Validate one raw row into a ContactGoldenExpectation, or explain why it can't be. */
export const parseContactGoldenRow = (
	row: RawContactGoldenRow,
): ContactGoldenParseResult => {
	if (!nonEmptyString(row.companyName)) {
		return { ok: false, error: 'companyName is empty' }
	}
	if (!nonEmptyString(row.domain)) {
		return { ok: false, error: 'domain is empty' }
	}
	if (
		!Array.isArray(row.expectedContacts) ||
		row.expectedContacts.length === 0
	) {
		return { ok: false, error: 'expectedContacts must be a non-empty array' }
	}

	const contacts: GoldenContact[] = []
	for (const raw of row.expectedContacts) {
		const parsed = parseContact(raw)
		if (typeof parsed === 'string') return { ok: false, error: parsed }
		contacts.push(parsed)
	}

	return {
		ok: true,
		value: {
			id: row.id,
			companyName: row.companyName,
			domain: row.domain,
			...(nonEmptyString(row.country) ? { country: row.country } : {}),
			expectedContacts: contacts,
		},
	}
}

/**
 * Validate a whole contact golden set, keeping the good rows and collecting a
 * reason for each bad one — so one malformed row cannot silently drop the set.
 */
export const parseContactGoldenSet = (
	rows: ReadonlyArray<RawContactGoldenRow>,
): {
	readonly golden: ReadonlyArray<ContactGoldenExpectation>
	readonly errors: ReadonlyArray<{
		readonly id: string
		readonly error: string
	}>
} => {
	const golden: ContactGoldenExpectation[] = []
	const errors: Array<{ id: string; error: string }> = []
	for (const row of rows) {
		const result = parseContactGoldenRow(row)
		if (result.ok) golden.push(result.value)
		else errors.push({ id: row.id, error: result.error })
	}
	return { golden, errors }
}
