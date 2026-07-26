import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'

// What each kind of document is called on screen. Shared so a document reads
// the same in a list, on its own page and in a picker.
export const DOCUMENT_KIND_LABELS: ReadonlyArray<{
	readonly value: string
	readonly label: MessageDescriptor
}> = [
	{ value: 'general', label: msg`General` },
	{ value: 'prenote', label: msg`Meeting prep` },
	{ value: 'postnote', label: msg`Meeting notes` },
	{ value: 'call_notes', label: msg`Call notes` },
	{ value: 'visit_notes', label: msg`Visit notes` },
	{ value: 'research', label: msg`Research` },
]
