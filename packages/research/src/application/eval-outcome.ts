/**
 * Adapts a finished research run — its status, its structured findings, and the
 * URLs it fetched — into the normalized `RunOutcome` the scorer reads.
 *
 * Grounding is judged by which pages the run reached (its fetched sources): the run
 * reaching the target's own site is what proves it researched the right company.
 * Per-field citations then point at whichever fetched page stated each fact, so the
 * finding's cited hosts are no longer the grounding signal — the fetch log is.
 *
 * This is the ONE place that knows the findings *shape* (for reading field values),
 * so a per-field-citation schema change lands here and the scorer's metrics stay put.
 */

import {
	type RunOutcome,
	type RunUsage,
	SCORABLE_FIELDS,
	type ScorableField,
	type TerminalStatus,
} from './eval-scoring'
import { contactFill, enrichmentFill } from './extraction-fill'
import { unwrapValue } from './guard-shapes'
import { hostOf } from './source-key'

const TERMINAL_STATUSES: ReadonlySet<string> = new Set<TerminalStatus>([
	'succeeded',
	'succeeded_low_confidence',
	'no_reliable_data',
	'failed',
	'cancelled',
])

// The set above is what the scorer can mark, a shorter list than the statuses
// that end a run. A deleted run stopped too but left no answer to mark, and a
// run that never finished at all means something went wrong upstream: both count
// as a failure rather than being guessed at.
const toTerminalStatus = (status: string): TerminalStatus =>
	TERMINAL_STATUSES.has(status) ? (status as TerminalStatus) : 'failed'

/**
 * Read one enrichment field's value. It is a bare string today and a `{ value }`
 * wrapper once citations move per-field; accept either so this adapter — and the
 * scorer behind it — is indifferent to which shape produced the run.
 */
const readFieldValue = (raw: unknown): string | null => {
	const inner = unwrapValue(raw)
	return typeof inner === 'string' ? inner : null
}

const enrichmentOf = (
	findings: unknown,
): Record<string, unknown> | undefined => {
	if (findings === null || typeof findings !== 'object') return undefined
	const enrichment = (findings as { enrichment?: unknown }).enrichment
	return enrichment !== null && typeof enrichment === 'object'
		? (enrichment as Record<string, unknown>)
		: undefined
}

/** Normalize a finished run into the shape the scorer consumes. */
export const outcomeFromRun = (input: {
	readonly status: string
	readonly findings: unknown
	/** URLs of the sources the run fetched (from `research_run_sources`). */
	readonly fetchedUrls: ReadonlyArray<string>
	/** What the run was billed, read off its own row; absent when not read back. */
	readonly usage?: RunUsage
}): RunOutcome => {
	const findings = input.findings
	const enrichment = enrichmentOf(findings)
	const fields: Partial<Record<ScorableField, string | null>> = {}
	if (enrichment !== undefined) {
		for (const field of SCORABLE_FIELDS) {
			fields[field] = readFieldValue(enrichment[field])
		}
	}

	// The people the run kept (after the entity + grounding guards), each with the
	// title it found or null — so the scorer can measure how many known contacts
	// came back with a title.
	const contacts: Array<{ name: string; role: string | null }> = []
	const rawContacts = (findings as { contacts?: unknown }).contacts
	if (Array.isArray(rawContacts)) {
		for (const contact of rawContacts) {
			if (contact === null || typeof contact !== 'object') continue
			const name = (contact as { name?: unknown }).name
			if (typeof name !== 'string' || name.trim() === '') continue
			contacts.push({
				name,
				role: readFieldValue((contact as { role?: unknown }).role),
			})
		}
	}

	const reachedDomains: string[] = []
	for (const url of input.fetchedUrls) {
		const host = hostOf(url)
		if (host !== null) reachedDomains.push(host)
	}

	// The pipeline stamps this on the findings when a registry lookup resolved the
	// target company by legal name — a reached signal independent of the fetch log.
	const registryConfirmed =
		findings !== null &&
		typeof findings === 'object' &&
		(findings as { registry_confirmed?: unknown }).registry_confirmed === true

	const profileFill = enrichmentFill(findings)
	const people = contactFill(findings)

	return {
		status: toTerminalStatus(input.status),
		reachedDomains,
		fields,
		contacts,
		registryConfirmed,
		profile: {
			fieldsTotal: profileFill.total,
			fieldsFilled: profileFill.filled,
			contactsNamed: people.named,
			contactsTitled: people.titled,
		},
		...(input.usage !== undefined ? { usage: input.usage } : {}),
	}
}
