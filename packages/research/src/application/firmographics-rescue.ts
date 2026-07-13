/**
 * A focused second extraction that recovers a company's size and tooling when the
 * broad pass left them empty.
 *
 * Same story as the contacts rescue: the broad `generateObject` spreads its
 * attention across the whole schema and drops the firmographic fields even when the
 * evidence states them — a live run had "624 employees" and a named TMS sitting in
 * the fetched pages, unread. This narrow pass pulls only the employee-size band and
 * the operational software, then fills them into the broad findings where they were
 * blank. It fires only when at least one is missing, so a complete run pays nothing.
 *
 * A value the pass recovers from a third-party aggregator is capped to medium
 * confidence by the source-tier guard downstream, exactly like any other
 * non-first-party field — this module only recovers the value; the guard chain
 * still decides how much to trust it.
 */

import { Schema } from 'effect'

import { Sourced } from './schemas/_shared'

// The narrow schema the focused pass fills — the two firmographics the broad pass
// most often drops. Both optional: the pass returns only what the evidence states.
export const FirmographicsRescueSchema = Schema.Struct({
	size_range: Schema.optionalKey(Sourced(Schema.String)),
	current_tools: Schema.optionalKey(Sourced(Schema.String)),
})

const RESCUE_KEYS = ['size_range', 'current_tools'] as const

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

/** Whether the broad findings are missing a size band or a tools value. */
export const needsFirmographicsRescue = (findings: unknown): boolean => {
	const enrichment = enrichmentOf(findings)
	if (enrichment === undefined) return true
	return RESCUE_KEYS.some(key => !hasValue(enrichment[key]))
}

export interface FirmographicsRescueTarget {
	readonly name: string
	readonly domain?: string | undefined
}

/** The focused-pass prompt: employee size band and operational software only. */
export const firmographicsRescuePrompt = (
	target: FirmographicsRescueTarget,
	evidence: string,
): string =>
	[
		`From the evidence below, find two facts about "${target.name}"${
			target.domain ? ` (official site ${target.domain})` : ''
		}:`,
		"- `size_range`: the company's employee-count band (e.g. an employee count or a range), with the source URL and a verbatim quote.",
		"- `current_tools`: the company's own business or operations software it actually uses — TMS, ERP, CRM, WMS, a load board — with the source URL and a verbatim quote. Exclude generic website infrastructure (analytics, CDNs, cookie/consent banners, reCAPTCHA).",
		'Only report a value that appears in the evidence; omit a field the evidence does not state. Never invent a headcount or a tool.',
		'',
		'Evidence:',
		evidence,
	].join('\n')

/**
 * Fill the broad findings' `size_range` / `current_tools` from the rescued values,
 * but only where the broad pass left them empty — a value the broad pass already
 * grounded is never overwritten. Returns the findings and how many fields it filled.
 */
export const mergeFirmographics = (
	findings: unknown,
	rescued: unknown,
): { readonly findings: unknown; readonly filled: number } => {
	const enrichment = enrichmentOf(findings)
	const rescuedEnrichment =
		rescued !== null && typeof rescued === 'object'
			? (rescued as Record<string, unknown>)
			: undefined
	if (enrichment === undefined || rescuedEnrichment === undefined) {
		return { findings, filled: 0 }
	}
	let filled = 0
	const nextEnrichment: Record<string, unknown> = { ...enrichment }
	for (const key of RESCUE_KEYS) {
		if (!hasValue(enrichment[key]) && hasValue(rescuedEnrichment[key])) {
			nextEnrichment[key] = rescuedEnrichment[key]
			filled++
		}
	}
	if (filled === 0) return { findings, filled: 0 }
	return {
		findings: { ...(findings as object), enrichment: nextEnrichment },
		filled,
	}
}
