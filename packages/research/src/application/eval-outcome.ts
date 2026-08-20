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
	discoveryRowDescription,
	discoveryRows,
	isDiscoveryScan,
} from './discovery-scan'
import {
	type RunOutcome,
	type RunUsage,
	SCORABLE_FIELDS,
	type ScorableField,
	type TerminalStatus,
} from './eval-scoring'
import { isConfirmedRow } from './existence-verdict'
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

/** A field's value, or null when it is missing or says nothing. */
const readFilled = (raw: unknown): string | null => {
	const value = readFieldValue(raw)
	return value === null || value.trim() === '' ? null : value.trim()
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
	/**
	 * Which shape the run answered in. A scan keeps its answer in a list of
	 * companies rather than a profile, and the shape is what says where to look.
	 */
	readonly schemaName?: string
}): RunOutcome => {
	const findings = input.findings
	const enrichment = enrichmentOf(findings)
	const fields: Partial<Record<ScorableField, string | null>> = {}
	if (enrichment !== undefined) {
		for (const field of SCORABLE_FIELDS) {
			fields[field] = readFieldValue(enrichment[field])
		}
	}

	// What the run said about the trades its request named. Taken whole or not at
	// all: a run finished before these counts existed carries the rest of the
	// block, and reading a missing count as nought would make it the one thing
	// these figures must never report — a clean pass.
	const quality =
		findings !== null && typeof findings === 'object'
			? (findings as { quality?: unknown }).quality
			: undefined
	const storedCoverage =
		quality !== null && typeof quality === 'object'
			? (quality as { coverage?: unknown }).coverage
			: undefined
	const countedList = (key: string): number | null => {
		if (storedCoverage === null || typeof storedCoverage !== 'object')
			return null
		const value = (storedCoverage as Record<string, unknown>)[key]
		return Array.isArray(value) ? value.length : null
	}
	const missing = countedList('uncovered')
	const neverSearched = countedList('unsearched')
	const thoughtAnswered = countedList('thought_answered')
	const reportedCoverage =
		missing !== null && neverSearched !== null && thoughtAnswered !== null
			? { missing, neverSearched, thoughtAnswered }
			: null

	// The people the run kept (after the entity + grounding guards), each with the
	// title it found or null — so the scorer can measure how many known contacts
	// came back with a title.
	const contacts: Array<{ name: string; role: string | null }> = []
	const rawContacts =
		findings !== null && typeof findings === 'object'
			? (findings as { contacts?: unknown }).contacts
			: undefined
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

	// The companies a scan came back with, which is the whole of a scan's answer
	// and so the only thing a scan can be scored on. A row with no name is left out:
	// there is nothing to tell it from another row, so counting it would make every
	// nameless row a company of its own.
	const companies: Array<{
		name: string
		website: string | null
		location: string | null
		describedAs: string
		confirmed: boolean
	}> = []
	for (const row of discoveryRows(input.schemaName, findings)) {
		const name = readFieldValue(row['name'])
		if (name === null || name.trim() === '') continue
		companies.push({
			name: name.trim(),
			website: readFilled(row['website']),
			location: readFilled(row['location']),
			describedAs: discoveryRowDescription(row),
			// Read through the same reader the run writes with, so a row carrying no
			// verdict reads as a candidate rather than as missing. That is what makes
			// two passes comparable: an unverified one scores a real nought, not a
			// blank.
			confirmed: isConfirmedRow(row),
		})
	}

	const profileFill = enrichmentFill(findings)
	const people = contactFill(findings)
	const isScan =
		input.schemaName !== undefined && isDiscoveryScan(input.schemaName)

	return {
		status: toTerminalStatus(input.status),
		reachedDomains,
		fields,
		contacts,
		companies,
		registryConfirmed,
		reportedCoverage,
		// Only a run that was asked for a profile is measured on how full it came back.
		// A search answers with a list and is never given one, so counting it reports
		// every search as having filled none of a shape nobody asked it for — a failing
		// grade where the honest answer is that it does not apply. What decides it is
		// the shape the run answered in, not whether the findings happen to carry a
		// profile: a run that was asked and came back with nothing has no block either,
		// and dropping it would lift the average by hiding the worst runs.
		...(isScan
			? {}
			: {
					profile: {
						fieldsTotal: profileFill.total,
						fieldsFilled: profileFill.filled,
						contactsNamed: people.named,
						contactsTitled: people.titled,
					},
				}),
		...(input.usage !== undefined ? { usage: input.usage } : {}),
	}
}
