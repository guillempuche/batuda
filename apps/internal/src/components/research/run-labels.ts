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
	failed: 'negative',
	no_reliable_data: 'caution',
	cancelled: 'neutral',
	deleted: 'neutral',
}

/** Badge tone for a run status; unknown tokens read neutral. */
export function statusTone(status: string): Tone {
	return STATUS_TONE[status] ?? 'neutral'
}
