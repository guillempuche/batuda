import {
	ATTRIBUTE_DESCRIPTION_MAX,
	ATTRIBUTE_ENUM_VALUE_MAX,
	ATTRIBUTE_KEY_PATTERN,
	ATTRIBUTE_KINDS,
	ATTRIBUTE_LABEL_MAX,
	ATTRIBUTE_RESERVED_KEYS,
	ATTRIBUTE_UNIT_MAX,
	foldLabel,
} from '@batuda/domain'

// The rules the attribute form applies before it sends anything, and which field
// a refusal belongs beside. They live apart from the sentences in
// `attribute-messages.ts` so they can be tested on their own: a Lingui macro only
// works once the build has rewritten it.
//
// A problem carries the server's own refusal code, so the form's own complaint
// and a write the server turned down are worded from the same table.

/** The refusal codes the form can raise before sending anything. */
export type AttributeProblem =
	| 'invalid_key'
	| 'reserved_key'
	| 'label_required'
	| 'label_too_long'
	| 'label_not_one_line'
	| 'unknown_kind'
	| 'enum_values_required'
	| 'enum_values_not_allowed'
	| 'enum_value_invalid'
	| 'unit_too_long'
	| 'description_too_long'

export type AttributeDraft = {
	// null while editing: the key is fixed once declared, and a name that became
	// reserved afterwards must not block an edit the server would accept.
	readonly key: string | null
	readonly label: string
	readonly kind: string
	readonly enumValues: ReadonlyArray<string>
	readonly unit: string
	readonly description: string
}

/**
 * The words a choice may take, read off one comma-separated field. Blanks go,
 * so a trailing comma is not a word.
 */
export function parseChoices(raw: string): ReadonlyArray<string> {
	return raw
		.split(',')
		.map(word => word.trim())
		.filter(word => word !== '')
}

/** The same words back in the field, for editing what was declared. */
export function formatChoices(values: ReadonlyArray<string>): string {
	return values.join(', ')
}

/**
 * What is wrong with a draft, or null when there is nothing to say. The order
 * and the codes follow the server's own checks, so the form complains about the
 * same thing the server would have.
 */
export function checkDraft(draft: AttributeDraft): AttributeProblem | null {
	if (draft.key !== null) {
		const key = draft.key.trim()
		if (!ATTRIBUTE_KEY_PATTERN.test(key)) return 'invalid_key'
		if (ATTRIBUTE_RESERVED_KEYS.has(key)) return 'reserved_key'
	}

	const label = draft.label.trim()
	if (label === '') return 'label_required'
	if (label.length > ATTRIBUTE_LABEL_MAX) return 'label_too_long'
	if (/[\r\n]/.test(label)) return 'label_not_one_line'

	if (!(ATTRIBUTE_KINDS as ReadonlyArray<string>).includes(draft.kind))
		return 'unknown_kind'

	const choices = draft.enumValues.map(word => word.trim())
	if (draft.kind === 'enum') {
		if (choices.length === 0) return 'enum_values_required'
		// Two spellings of one word would leave a filter with two entries for the
		// same answer, so they are the same word here as they are on the server.
		const seen = new Set<string>()
		for (const word of choices) {
			const folded = foldLabel(word)
			if (folded === '' || word.length > ATTRIBUTE_ENUM_VALUE_MAX)
				return 'enum_value_invalid'
			if (seen.has(folded)) return 'enum_value_invalid'
			seen.add(folded)
		}
	} else if (choices.length > 0) {
		return 'enum_values_not_allowed'
	}

	if (draft.unit.trim().length > ATTRIBUTE_UNIT_MAX) return 'unit_too_long'
	if (draft.description.trim().length > ATTRIBUTE_DESCRIPTION_MAX)
		return 'description_too_long'

	return null
}

/** The fields of the attribute form a refusal can be shown beside. */
export type AttributeField =
	| 'key'
	| 'label'
	| 'kind'
	| 'enumValues'
	| 'unit'
	| 'description'

const FIELD_FOR_OUTCOME: Record<string, AttributeField> = {
	invalid_key: 'key',
	reserved_key: 'key',
	duplicate_key: 'key',
	label_required: 'label',
	label_too_long: 'label',
	label_not_one_line: 'label',
	unknown_kind: 'kind',
	enum_values_required: 'enumValues',
	enum_values_not_allowed: 'enumValues',
	enum_value_invalid: 'enumValues',
	unit_too_long: 'unit',
	description_too_long: 'description',
}

/**
 * The field a refusal belongs beside, or null when it is about the whole write
 * — who may do it, which campaign it lands on, or how the key reads elsewhere.
 * Those go in a banner, where they are not blamed on one box.
 */
export function fieldForOutcome(outcome: string | null): AttributeField | null {
	return (outcome === null ? undefined : FIELD_FOR_OUTCOME[outcome]) ?? null
}
