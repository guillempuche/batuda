import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'

// The verdict is stored as the research vocabulary wrote it; the reader sees it
// in their own language, and a value the vocabulary does not know is shown
// as-is rather than hidden — nothing enforces the four words, so a run may write
// a fifth and the company carrying it still has to be readable and findable.
//
// One copy, read by the company page and by the filter that narrows a list to a
// verdict: two lists of these would name the same verdict differently on two
// screens.
const VERDICT_LABEL: Record<string, MessageDescriptor> = {
	strong_fit: msg`Strong fit`,
	possible_fit: msg`Possible fit`,
	weak_fit: msg`Weak fit`,
	no_fit: msg`Not a fit`,
}

export function verdictLabel(
	i18n: { _: (descriptor: MessageDescriptor) => string },
	verdict: string,
): string {
	const label = VERDICT_LABEL[verdict]
	return label === undefined ? verdict : i18n._(label)
}
