/**
 * Drops fabricated citations from a run's findings before they are persisted.
 *
 * The model cites sources by a free-text `source_id`, and left unchecked it will
 * invent them. Only a source the run actually fetched may be cited, so this
 * walks the findings and removes every citation whose `source_id` is not backed
 * by a fetched page. A descriptive finding keeps its remaining citations; a
 * proposed CRM update left with none is dropped whole, because an uncited
 * proposed write is exactly the fabrication we must never let reach the apply
 * path.
 *
 * The walk is structural, not path-based: `citations` sits at a different depth
 * in every findings schema, so it filters wherever it finds a `citations` array.
 */

import { clipText } from '@batuda/domain'

import { isCitedField } from './guard-shapes'
import { lettersAndDigits, quoteIsVerbatim } from './scalar-field-guard'
import { canonicalizeUrl, hostOf, isWebAddress, pathOf } from './source-key'

/**
 * A per-field scalar nulled because its cited source was not among the run's fetched
 * pages — recorded so the grounding trace can tell a citation-guard drop apart from a
 * scalar-guard one when a field comes back empty.
 */
export interface CitationDrop {
	readonly field: string
	readonly value: string
	readonly sourceId: string
}

export interface CitationValidation {
	readonly findings: unknown
	/** How many citations were seen and how many survived, for observability. */
	readonly total: number
	readonly kept: number
	/** Quotes taken off a citation because the words are on no fetched page;
	 * the citation keeps its page. */
	readonly strippedQuotes: number
	/** Citations folded into an earlier one of the same page and words. */
	readonly folded: number
	/** Per-field scalars dropped because their cited source was never fetched. */
	readonly drops: ReadonlyArray<CitationDrop>
}

// A source named by its host alone — "einforma.com" — rather than by a page.
const isBareHost = (sourceId: string): boolean =>
	isWebAddress(sourceId) && !/:\/\//.test(sourceId) && pathOf(sourceId) === '/'

/**
 * Builds the reading that puts a citation's `source_id` back to the page it
 * names. A model cites a page it read by the opaque id the manifest labelled
 * it with (`src_…`), or by its host alone when the fact came from a search
 * result's snippet; both are the run's own shorthand, and a reader is owed the
 * address. The id becomes the page's URL. A bare host becomes a page only when
 * the words quoted for it are on exactly one fetched page of that host — the
 * quote is what ties a line to a page, and a host with several pages, or a
 * citation with no words, stays as written, since a guess at which page would
 * be a fabrication of this code's own.
 */
export const citationSourceResolver = (
	sources: ReadonlyArray<{
		readonly localRef: string
		readonly sourceId: string
	}>,
	pages: ReadonlyArray<{
		readonly sourceId: string
		readonly text: string
	}> = [],
): ((sourceId: string, quote?: string) => string) => {
	const byId = new Map<string, string>()
	const pagesByHost = new Map<string, Array<string>>()
	for (const source of sources) {
		byId.set(source.sourceId, source.localRef)
		const host = hostOf(source.localRef)
		if (host === null) continue
		const listed = pagesByHost.get(host) ?? []
		listed.push(source.sourceId)
		pagesByHost.set(host, listed)
	}
	const textById = new Map(pages.map(page => [page.sourceId, page.text]))
	return (sourceId, quote) => {
		const byOpaqueId = byId.get(sourceId)
		if (byOpaqueId !== undefined) return byOpaqueId
		if (!isBareHost(sourceId) || quote === undefined || quote.trim() === '')
			return sourceId
		const host = hostOf(sourceId)
		const hostPages = host === null ? [] : (pagesByHost.get(host) ?? [])
		const quotingPages = hostPages.filter(id => {
			const text = textById.get(id)
			return text !== undefined && quoteIsVerbatim(quote, text.toLowerCase())
		})
		const page =
			quotingPages.length === 1 ? byId.get(quotingPages[0] ?? '') : undefined
		return page ?? sourceId
	}
}

// Bound a dropped value so a long string in the value slot can't bloat a log line.
//
// The mark goes on only when something was actually taken off. Asking whether the
// text is long and then cutting it are two readings of "long", and where they
// disagree — text of few characters stored in many units — a value that was never
// shortened wears a mark saying it was.
const boundDropValue = (value: unknown): string => {
	const text = typeof value === 'string' ? value : JSON.stringify(value)
	const bounded = clipText(text, 120)
	return bounded === text ? text : `${bounded}…`
}

/**
 * Builds the "is this citation backed by a source the run actually saw" test, from a
 * run's linked (fetched) sources plus the hosts of the search results it surfaced. A
 * citation is accepted when its URL matches a fetched source exactly (canonical URL or
 * the opaque source id) OR when its site (host) matches one a fetched source belongs to
 * — so a model that tidied the URL (dropped the path, added `www.`, cited the homepage)
 * is still credited to the page it read.
 *
 * `searchHosts` adds the sites of the search results the run pulled up. The extraction
 * prompt tells the model to cite a result's URL for a fact it saw only in that result's
 * snippet, so those hosts must count as seen too — otherwise a real value the run
 * genuinely found is nulled just because its page was never fully fetched. An off-site
 * citation the run never saw at all is still rejected, and per-value truth is unaffected:
 * the scalar and value guards check each value against the gathered evidence separately.
 */
export const groundedCitationTest = (
	sources: ReadonlyArray<{
		readonly localRef: string
		readonly sourceId: string
	}>,
	searchHosts: ReadonlyArray<string> = [],
): ((sourceId: string) => boolean) => {
	const keys = new Set<string>()
	const hosts = new Set<string>()
	for (const source of sources) {
		keys.add(canonicalizeUrl(source.localRef))
		keys.add(source.sourceId)
		const host = hostOf(source.localRef)
		if (host !== null) hosts.add(host)
	}
	for (const searchHost of searchHosts) {
		const host = hostOf(searchHost)
		if (host !== null) hosts.add(host)
	}
	return sourceId => {
		if (keys.has(canonicalizeUrl(sourceId)) || keys.has(sourceId)) return true
		const host = hostOf(sourceId)
		return host !== null && hosts.has(host)
	}
}

const hasCitations = (entry: unknown): boolean => {
	const citations = (entry as { citations?: unknown }).citations
	return Array.isArray(citations) && citations.length > 0
}

// What tells two citations apart once each names its page: the page and the
// words, letters only, so a line the page breaks differently is the one line.
const sameCitationKey = (sourceId: string, quote: unknown): string =>
	`${canonicalizeUrl(sourceId).toLowerCase()}|${typeof quote === 'string' ? lettersAndDigits(quote) : ''}`

/**
 * `resolve` puts a citation's id back to the page it names before it is judged
 * or stored (see `citationSourceResolver`); `lowerCorpus` is the evidence the
 * run read, lower-cased, and with it a quote that is not the page's own words
 * comes off its citation — the page was read, the words were not on it, and a
 * person named on a page in a photo caption is still a person on that page
 * once the model's remark about the caption is gone. Left out, only the source
 * is judged. A page cited several times over for the same words is cited once,
 * and a citation left with no words folds into one of the same page that has
 * them, judged after the ids are put back so two spellings of one page fold.
 */
export const validateFindingCitations = (
	findings: unknown,
	isGrounded: (sourceId: string) => boolean,
	options: {
		readonly resolve?: (sourceId: string, quote?: string) => string
		readonly lowerCorpus?: string
	} = {},
): CitationValidation => {
	let total = 0
	let kept = 0
	let strippedQuotes = 0
	let folded = 0
	const drops: CitationDrop[] = []
	const resolve = options.resolve ?? ((sourceId: string) => sourceId)
	const lowerCorpus = options.lowerCorpus ?? ''

	// One page's words are quoted on many rows of a scan; asked once each.
	const quotesJudged = new Map<string, boolean>()
	const quoteIsOnAPage = (quote: unknown): boolean => {
		if (lowerCorpus === '' || typeof quote !== 'string' || quote.trim() === '')
			return true
		const judged = quotesJudged.get(quote)
		if (judged !== undefined) return judged
		const onAPage = quoteIsVerbatim(quote, lowerCorpus)
		quotesJudged.set(quote, onAPage)
		return onAPage
	}

	const walk = (value: unknown, key?: string): unknown => {
		if (Array.isArray(value)) {
			if (key === 'citations') {
				const seen = new Set<string>()
				const judged = value.flatMap(entry => {
					total++
					const record =
						entry !== null && typeof entry === 'object'
							? (entry as Record<string, unknown>)
							: null
					const sourceId = record?.['source_id']
					if (record === null || typeof sourceId !== 'string') return []
					const quote = record['quote']
					const resolved = resolve(
						sourceId,
						typeof quote === 'string' ? quote : undefined,
					)
					if (!isGrounded(resolved)) return []
					const onAPage = quoteIsOnAPage(quote)
					if (!onAPage) strippedQuotes++
					const same = sameCitationKey(resolved, onAPage ? quote : undefined)
					if (seen.has(same)) {
						folded++
						return []
					}
					seen.add(same)
					const { quote: _quote, ...withoutQuote } = record
					const settled = onAPage
						? resolved === sourceId
							? entry
							: { ...record, source_id: resolved }
						: { ...withoutQuote, source_id: resolved }
					return [{ settled, page: canonicalizeUrl(resolved).toLowerCase() }]
				})
				// A citation left with no words says no more than one of the same
				// page that has them.
				const pagesWithWords = new Set(
					judged.flatMap(({ settled, page }) =>
						typeof (settled as Record<string, unknown>)['quote'] === 'string'
							? [page]
							: [],
					),
				)
				return judged.flatMap(({ settled, page }) => {
					const hasWords =
						typeof (settled as Record<string, unknown>)['quote'] === 'string'
					if (!hasWords && pagesWithWords.has(page)) {
						folded++
						return []
					}
					kept++
					return [settled]
				})
			}
			const walked = value.map(item => walk(item))
			// A proposed update whose citations were all dropped is itself dropped —
			// an uncited proposed CRM write must never become applyable.
			return key === 'proposed_updates' ? walked.filter(hasCitations) : walked
		}
		if (value !== null && typeof value === 'object') {
			// A per-field Sourced wrapper carries its own `source_id` beside a
			// `value` (a bare citation entry has a source_id but no `value`). Judge it
			// like a citation, but drop the whole field when the source was not
			// fetched: a single scalar with a fabricated source is treated as absent
			// rather than shipped unsourced, so a value that never reached a real page
			// cannot survive. (A descriptive finding's citations array still keeps its
			// value and drops only the bad citation — that rule is for prose, not a
			// scalar fact.)
			if (isCitedField(value)) {
				total++
				const resolved = resolve(value.source_id)
				if (isGrounded(resolved)) {
					kept++
					return resolved === value.source_id
						? value
						: { ...value, source_id: resolved }
				}
				drops.push({
					field: key ?? 'field',
					value: boundDropValue(value.value),
					sourceId: value.source_id,
				})
				return null
			}
			return Object.fromEntries(
				Object.entries(value as Record<string, unknown>).map(
					([k, v]) => [k, walk(v, k)] as const,
				),
			)
		}
		return value
	}

	return {
		findings: walk(findings),
		total,
		kept,
		strippedQuotes,
		folded,
		drops,
	}
}
