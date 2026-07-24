import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'

import type { Tone } from './proposal-logic'

// Localized labels + tones for the raw run-status tokens the API returns, so
// screens render "Succeeded" / "No reliable data" instead of the machine
// string. Resolve a descriptor with `i18n._(...)`; an unknown token falls back
// to the raw string at the call site.

const STATUS_LABEL: Record<string, MessageDescriptor> = {
	queued: msg`Queued`,
	running: msg`Running`,
	paused: msg`Paused`,
	succeeded: msg`Succeeded`,
	succeeded_low_confidence: msg`Needs review`,
	failed: msg`Failed`,
	no_reliable_data: msg`No reliable data`,
	cancelled: msg`Cancelled`,
	deleted: msg`Deleted`,
}

/** Localized label for a run status, or null for an unknown token. */
export function statusLabel(status: string): MessageDescriptor | null {
	return STATUS_LABEL[status] ?? null
}

const STATUS_TONE: Record<string, Tone> = {
	queued: 'neutral',
	running: 'info',
	paused: 'caution',
	succeeded: 'positive',
	succeeded_low_confidence: 'caution',
	failed: 'negative',
	no_reliable_data: 'caution',
	cancelled: 'neutral',
	deleted: 'neutral',
}

/** Badge tone for a run status; unknown tokens read neutral. */
export function statusTone(status: string): Tone {
	return STATUS_TONE[status] ?? 'neutral'
}

const OPERATION_LABEL: Record<string, MessageDescriptor> = {
	create: msg`New`,
	update: msg`Update`,
	add_channel: msg`Add channel`,
	merge: msg`Merge`,
}

/** Localized label for a proposal operation, or null for an unknown token. */
export function operationLabel(operation: string): MessageDescriptor | null {
	return OPERATION_LABEL[operation] ?? null
}

const SUBJECT_TABLE_LABEL: Record<string, MessageDescriptor> = {
	companies: msg`Company`,
	contacts: msg`Contact`,
}

/** Localized label for a subject table name, or null for an unknown token. */
export function subjectTableLabel(table: string): MessageDescriptor | null {
	return SUBJECT_TABLE_LABEL[table] ?? null
}
