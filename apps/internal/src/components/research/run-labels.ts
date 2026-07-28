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

// Proper names for the record fields a change can write, so a reader never sees
// the name the database uses. Both spellings of a field are accepted, because a
// change may name it either way round and both are honoured when it is applied.
const FIELD_LABEL: Record<string, MessageDescriptor> = {
	industry: msg`Industry`,
	size_range: msg`Size`,
	country: msg`Country`,
	location: msg`Location`,
	address: msg`Address`,
	website: msg`Website`,
	current_tools: msg`Current tools`,
	tax_id: msg`Tax ID`,
	role: msg`Role`,
	email: msg`Email`,
	phone: msg`Phone`,
	linkedin: msg`LinkedIn`,
	notes: msg`Notes`,
	tags: msg`Tags`,
	products_fit: msg`Products that fit`,
	latitude: msg`Latitude`,
	longitude: msg`Longitude`,
}

/** The same field name written the other way round, to look up one spelling. */
function toSnake(key: string): string {
	return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

/** Proper name for a record field, or null when the field has none yet. */
export function fieldLabel(key: string): MessageDescriptor | null {
	return FIELD_LABEL[key] ?? FIELD_LABEL[toSnake(key)] ?? null
}
