import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'

import type { AttributeKind } from '@batuda/domain'

// The words the settings page puts on an attribute: what each kind is called,
// and what to say when a write comes back refused. Resolve a descriptor with
// `i18n._(...)` at the call site.
//
// The form's own checks (`attribute-checks.ts`) refuse with the server's codes,
// so one table words both a form the page stopped and a write the server turned
// down — the reader gets the same sentence either way.

const KIND_LABEL: Record<AttributeKind, MessageDescriptor> = {
	text: msg`Text`,
	number: msg`Number`,
	enum: msg`Choice`,
	boolean: msg`Yes or no`,
	date: msg`Date`,
}

/** What a kind is called in the reader's words. */
export function kindLabel(kind: AttributeKind): MessageDescriptor {
	return KIND_LABEL[kind]
}

const OUTCOME_MESSAGE: Record<string, MessageDescriptor> = {
	forbidden: msg`Only an organisation admin can change the attributes.`,
	not_found: msg`This attribute no longer exists.`,
	unknown_stack: msg`That campaign no longer exists.`,
	duplicate_key: msg`This campaign already records something under that key.`,
	too_many_active: msg`This stack already has 8 active attributes. Retire one first.`,
	invalid_key: msg`A key is lowercase letters, digits and underscores, starts with a letter, and is at least 2 characters long.`,
	reserved_key: msg`A research run already uses that name for something else. Pick another key.`,
	label_required: msg`Give the attribute a name.`,
	label_too_long: msg`The name is too long. Keep it to 40 characters.`,
	label_not_one_line: msg`The name has to fit on one line.`,
	unknown_kind: msg`Pick what kind of fact this is.`,
	enum_values_required: msg`List the words this fact may take, separated by commas.`,
	enum_values_not_allowed: msg`Only a choice takes a list of words.`,
	enum_value_invalid: msg`Each word has to be different and no longer than 32 characters.`,
	unit_too_long: msg`The unit is too long. Keep it to 16 characters.`,
	description_too_long: msg`The note is too long. Keep it to 500 characters.`,
	kind_mismatch: msg`Another stack already declares this key with a different kind, unit or choices. Match it or pick another key.`,
	key_in_use: msg`Companies already hold values under this key, so its kind, unit and choices cannot change. Retire it and declare a new key instead.`,
	agent_not_research: msg`Only a research campaign records attributes.`,
	stack_not_org: msg`Only a campaign the organisation owns records attributes.`,
}

/** What a refused save reads as when the server named nothing a reader can use. */
export const SAVE_FAILED = msg`Couldn't save the attribute. Please try again.`

/** The same, for retiring, bringing back or deleting one. */
export const CHANGE_FAILED = msg`Couldn't change the attribute. Please try again.`

/**
 * The sentence for a refusal code. A code the page does not know — one added on
 * the server, or a call that never reached it — reads as the caller's own plain
 * fallback rather than a machine word.
 */
export function outcomeMessage(
	outcome: string | null,
	fallback: MessageDescriptor,
): MessageDescriptor {
	return (outcome === null ? undefined : OUTCOME_MESSAGE[outcome]) ?? fallback
}
