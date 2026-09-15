import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'

// What the server says when it refuses an attribute value or an attribute
// filter. It sends a reason and the key, never a sentence, so the words are
// written here, beside the screens that show them.
const REASON_MESSAGE: Record<string, MessageDescriptor> = {
	undeclared_key: msg`Nothing declares this attribute any more, so it cannot take a value.`,
	wrong_kind: msg`The value does not fit the kind this attribute was declared as.`,
	unknown_run: msg`The research run named for this value was not found.`,
	filter_incomplete: msg`The attribute filter needs an attribute, a comparison and a value.`,
	unknown_operator: msg`That comparison is not one the list knows.`,
	operator_not_for_kind: msg`That comparison does not fit the kind of this attribute.`,
	value_not_for_kind: msg`That value does not fit the kind of this attribute.`,
}

const FALLBACK = msg`The attribute was refused.`

export function attributeRejectedMessage(reason: string): MessageDescriptor {
	return REASON_MESSAGE[reason] ?? FALLBACK
}
