/**
 * Keeps an open-web search anchored to the company the run is about.
 *
 * The model writes its own `web_search` queries, and when one leaves out the
 * company name the provider answers with pages about something else entirely — a
 * research paper, an unrelated PDF — that the run then wastes a fetch on. This
 * prepends the company's quoted name to a query that does not already name it, so
 * the provider stays on the target. A query that already reaches the company (its
 * name, a distinctive word from it, or its own domain is present) is left alone,
 * and a run with no single target company (a scan or freeform run, where
 * `targets` is null) is never rewritten.
 */

import { classifyEntityMatch, type EntityTargets } from './entity-guard'

/**
 * The search query to actually send: the original when it already reaches the
 * target company or the run has no single target, otherwise the original with the
 * company's quoted name prepended as an anchor.
 */
export const scopeSearchQuery = (args: {
	readonly query: string
	readonly name: string | undefined
	readonly targets: EntityTargets | null | undefined
}): string => {
	const { query, name, targets } = args
	// A scan/freeform run reports third-party companies, so a search of its own is
	// not about one target and must not be narrowed to a name.
	if (targets == null) return query
	const trimmedName = name?.trim() ?? ''
	if (trimmedName === '') return query
	// The query already names the company (or its domain/a distinctive word) — it
	// is on-target, and prepending the name again would only narrow it.
	if (classifyEntityMatch(targets, query) !== 'absent') return query
	return `"${trimmedName}" ${query.trim()}`.trim()
}
