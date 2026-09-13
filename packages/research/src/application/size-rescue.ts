/**
 * A focused second extraction that recovers a company's size when the broad pass
 * left it empty.
 *
 * Same story as the contacts rescue: the broad `generateObject` spreads its
 * attention across the whole schema and drops the headcount even when the
 * evidence states it — a live run had "624 employees" sitting in the fetched
 * pages, unread. This narrow pass asks for the employee-size band and nothing
 * else, then fills it into the broad findings where it was blank. It fires only
 * when the band is missing, so a complete run pays nothing.
 *
 * A value the pass recovers from a third-party aggregator is capped to medium
 * confidence by the source-tier guard downstream, exactly like any other
 * non-first-party field — this module only recovers the value; the guard chain
 * still decides how much to trust it.
 */

import { Schema } from 'effect'

import { Sourced } from './schemas/_shared'

// The narrow schema the focused pass fills: the employee count alone. Optional,
// so the pass returns only what the evidence states.
export const SizeRescueSchema = Schema.Struct({
	size_range: Schema.optionalKey(Sourced(Schema.String)),
})

const enrichmentOf = (
	findings: unknown,
): Record<string, unknown> | undefined => {
	if (findings === null || typeof findings !== 'object') return undefined
	const enrichment = (findings as { enrichment?: unknown }).enrichment
	return enrichment !== null && typeof enrichment === 'object'
		? (enrichment as Record<string, unknown>)
		: undefined
}

// A per-field value counts as present only when it carries a non-empty string
// value — a missing key, or a `{ value: null }` a guard blanked, is still "empty".
const hasValue = (field: unknown): boolean =>
	field !== null &&
	typeof field === 'object' &&
	typeof (field as { value?: unknown }).value === 'string' &&
	(field as { value: string }).value.trim() !== ''

export interface SizeRescueTarget {
	readonly name: string
	readonly domain?: string | undefined
}

// Whether the evidence already states an employee headcount — a number next to an
// employee / staff / workforce word, in the languages the pipeline researches in.
// The phase-1 loop reads this to decide it has gathered the size before finishing.
// A loose heuristic is fine: a miss only costs one extra search, a false hit only
// skips a nudge. It deliberately ignores other counts (carriers, customers, trailers)
// that are not headcounts.
const HEADCOUNT_SIGNAL =
	/\d[\d.,]*\s*\+?\s*(?:employ|headcount|staff|people|emplead|trabajador|treballador|persona|plantilla)|(?:employ|headcount|workforce|staff|team of|plantilla|emplead|trabajador|treballador|personal)[^.\n]{0,25}?\d/i

export const hasHeadcountSignal = (text: string): boolean =>
	HEADCOUNT_SIGNAL.test(text)

/** Whether the broad pass left the size band empty. */
export const needsSizeRescue = (findings: unknown): boolean => {
	const enrichment = enrichmentOf(findings)
	if (enrichment === undefined) return true
	return !hasValue(enrichment['size_range'])
}

/** The size-only focused-pass prompt: the employee headcount, nothing else. */
export const sizeRescuePrompt = (
	target: SizeRescueTarget,
	evidence: string,
	sourceManifest?: string,
): string => {
	const citation =
		sourceManifest && sourceManifest.trim().length > 0
			? `Cite the value with one of these exact fetched source URLs, copied verbatim:\n\n${sourceManifest}`
			: 'Cite the value with the exact source URL it came from, copied verbatim.'
	return [
		`From the evidence below, find ONE fact about "${target.name}"${
			target.domain ? ` (official site ${target.domain})` : ''
		}: how many people it employs.`,
		'Report `size_range` as the employee headcount the evidence states — an exact count or a range ("about 500", "685 employees", "1,000+"). It is usually NOT on the company\'s own homepage: read the whole evidence, including third-party pages (LinkedIn, ZoomInfo, news, directories) and search snippets, and take any employee-count figure stated there, with its source URL and a verbatim quote.',
		'Report a value ONLY if the evidence states a number of employees; if it states none, omit size_range. Never invent a headcount.',
		citation,
		'',
		'Evidence:',
		evidence,
	].join('\n')
}

/**
 * Fill the broad findings' `size_range` from the rescued value, but only where
 * the broad pass left it empty — a value the broad pass already grounded is
 * never overwritten. Returns the findings and whether it filled the band.
 */
export const mergeSizeRescue = (
	findings: unknown,
	rescued: unknown,
): { readonly findings: unknown; readonly filled: number } => {
	const enrichment = enrichmentOf(findings)
	const rescuedEnrichment =
		rescued !== null && typeof rescued === 'object'
			? (rescued as Record<string, unknown>)
			: undefined
	if (
		enrichment === undefined ||
		rescuedEnrichment === undefined ||
		hasValue(enrichment['size_range']) ||
		!hasValue(rescuedEnrichment['size_range'])
	) {
		return { findings, filled: 0 }
	}
	return {
		findings: {
			...(findings as object),
			enrichment: {
				...enrichment,
				size_range: rescuedEnrichment['size_range'],
			},
		},
		filled: 1,
	}
}
