/**
 * Drops a scanned company whose only evidence that it exists is a social post.
 *
 * A discovery scan hands back companies nobody asked it about by name, so each one
 * has to carry its own proof of being a real, findable business. Two came back from
 * a metal-fabrication scan with no address, no website and no directory entry —
 * their whole case was one Instagram post each. A post is not a record: it shows
 * someone welding, not a company anyone can look up, write to, or visit.
 *
 * The rule is narrow on purpose. A post alongside anything else is fine — plenty of
 * real firms are easiest to find that way, and the other source is what makes them
 * checkable. Only an entry whose every citation is a post is dropped, because there
 * is nothing left to check it against.
 *
 * Citations pointing at pages the run never reached are gone by the time this runs;
 * the citation guard removes them first. So "every citation is a post" is judged on
 * what survived, which is what the finding actually rests on.
 */

import { classifyNamespace } from './entity-source-guard'
import { isPlainObject } from './guard-shapes'

// The list each discovery schema returns. A schema absent here returns companies
// the caller already named, which carry their own identity.
const SCANNED_ENTRIES: Record<string, string> = {
	prospect_scan_v1: 'prospects',
	competitor_scan_v1: 'competitors',
}

export interface ScanEvidenceResult {
	readonly findings: unknown
	/** Entries dropped for resting on nothing but posts. */
	readonly dropped: number
	/** The names dropped, so a run can say which companies went and why. */
	readonly droppedNames: ReadonlyArray<string>
}

const citationSourceIds = (entry: Record<string, unknown>): string[] => {
	const citations = entry['citations']
	if (!Array.isArray(citations)) return []
	return citations
		.map(c => (isPlainObject(c) ? c['source_id'] : undefined))
		.filter((id): id is string => typeof id === 'string')
}

/**
 * Remove scanned entries backed only by social posts. A non-discovery schema, or
 * findings that are not the shape a scan returns, pass through untouched.
 */
export const guardScanEvidence = (
	schemaName: string,
	findings: unknown,
): ScanEvidenceResult => {
	const field = SCANNED_ENTRIES[schemaName]
	if (field === undefined || !isPlainObject(findings))
		return { findings, dropped: 0, droppedNames: [] }

	const entries = findings[field]
	if (!Array.isArray(entries)) return { findings, dropped: 0, droppedNames: [] }

	const droppedNames: string[] = []
	const kept = entries.filter(entry => {
		if (!isPlainObject(entry)) return true
		const sourceIds = citationSourceIds(entry)
		// Nothing cited at all is a different shortfall, and the citation guard and
		// the run's own quality signal already speak to it. This rule is only about
		// an entry whose evidence exists and is all posts.
		if (sourceIds.length === 0) return true
		if (!sourceIds.every(id => classifyNamespace(id) === 'ugc')) return true
		const name = entry['name']
		droppedNames.push(typeof name === 'string' ? name : 'unnamed')
		return false
	})

	if (droppedNames.length === 0)
		return { findings, dropped: 0, droppedNames: [] }

	return {
		findings: { ...findings, [field]: kept },
		dropped: droppedNames.length,
		droppedNames,
	}
}
