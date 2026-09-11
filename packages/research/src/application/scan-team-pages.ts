/**
 * Picks the one page per company most likely to name its people, for a search
 * that came back with companies but no names.
 *
 * A run about a single company already sweeps its own site for the team and about
 * pages, deterministically, rather than hoping the model navigates there. A search
 * never did: that sweep hangs off the one company the run is about, and a search
 * is about none. So a scan's people came only from whatever pages the model
 * happened to open — two "about" pages across nine companies, in the run this was
 * written for — while the extraction step sitting behind them can read a full
 * roster off a team page without trouble.
 *
 * Nothing is guessed. The candidates are links the run genuinely saw on pages it
 * already fetched, so a company that never linked a team page is passed over
 * rather than fetched into a 404. One page per company, and only companies that
 * came back with nobody, so the cost is bounded by how badly the list is doing
 * rather than by its length.
 */

import { aboutPageCandidates } from './about-pages'
import { domainHost } from './entity-guard'
import { isValueWrapper, unwrapValue } from './guard-shapes'

export interface TeamPageTarget {
	/** The company the page belongs to, for the log line. */
	readonly name: string
	readonly url: string
}

const rowWebsite = (row: Record<string, unknown>): string | undefined => {
	const website = row['website']
	const address = isValueWrapper(website) ? unwrapValue(website) : website
	return typeof address === 'string' && address.trim() !== ''
		? address
		: undefined
}

const namesNobody = (row: Record<string, unknown>): boolean => {
	const contacts = row['contacts']
	return !Array.isArray(contacts) || contacts.length === 0
}

export const teamPagesForRows = (args: {
	readonly findings: unknown
	readonly listField: string | undefined
	/** Every address the run has seen linked, from the pages it already read. */
	readonly addresses: ReadonlyArray<string>
	/** Whether a page has been fetched, or tried, already. */
	readonly alreadyTried: (url: string) => boolean
	readonly max: number
}): ReadonlyArray<TeamPageTarget> => {
	const { findings, listField } = args
	if (
		args.max <= 0 ||
		listField === undefined ||
		findings === null ||
		typeof findings !== 'object' ||
		Array.isArray(findings)
	) {
		return []
	}
	const rows = (findings as Record<string, unknown>)[listField]
	if (!Array.isArray(rows)) return []

	const picked: TeamPageTarget[] = []
	for (const row of rows) {
		if (picked.length >= args.max) break
		if (row === null || typeof row !== 'object') continue
		const record = row as Record<string, unknown>
		// A company that already named somebody has had its answer; the round's
		// money is better spent on one that has not.
		if (!namesNobody(record)) continue
		const website = rowWebsite(record)
		const host = website === undefined ? undefined : domainHost(website)
		if (host === undefined) continue
		// Team and about pages only. This sweep exists to find the people, and a
		// contact page names a switchboard — buying one to look for staff spends
		// the fetch and comes back with nobody.
		const candidate = aboutPageCandidates(args.addresses, host, 4, 1).find(
			url => !args.alreadyTried(url),
		)
		if (candidate === undefined) continue
		picked.push({
			name: typeof record['name'] === 'string' ? record['name'] : host,
			url: candidate,
		})
	}
	return picked
}
