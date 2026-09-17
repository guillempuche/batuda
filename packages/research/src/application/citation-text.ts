/**
 * Tidies the words a run quotes before any guard reads them.
 *
 * A model copies a page's words and then dresses them: it wraps the line in
 * quote marks of its own, pastes the citation style of a search result after
 * it ("…[source: einforma.com]."), and leaves the zero-width characters a
 * snippet carried. None of that is on the page, so a quote dressed this way
 * fails the rule that a quote is the page's own words — and the value it
 * backs goes with it, for a fault in the dressing rather than in the reading.
 *
 * So every `quote` and `evidence_quote` is stripped down to the words. Runs
 * before the citation guard, so what that guard judges is the words themselves.
 */

import { isPlainObject } from './guard-shapes'

// The citation style a search result is written in, pasted after the words it
// belongs to: "[source: einforma.com]", "[src: acme.es]", "[fuente: …]".
const SOURCE_MARKER =
	/\s*\[\s*(?:source|src|fuente|font|quelle|fonte)\s*:[^\]]*\]/giu
// Characters that take no room and mean nothing: the joiners a snippet carries.
// Spelled by code point, since written out they cannot be seen.
const ZERO_WIDTH = /\u200b|\u200c|\u200d|\u2060|\ufeff/gu
// A footnote number a page or a model hangs on a line: "…[3]".
const FOOTNOTE = /\s*\[\d{1,3}\]/gu

// The quote marks a model wraps a line in, and the mark each one closes with.
const WRAPPING_MARKS: ReadonlyArray<readonly [string, string]> = [
	['"', '"'],
	['“', '”'],
	['«', '»'],
	['‘', '’'],
	["'", "'"],
]

// The line without the marks a model wrapped it in, or as it stands when the
// marks are the page's own. A wrapping is one pair around the whole line, so
// a line that also carries the mark inside — two quoted names in one sentence
// — is left whole rather than cut to a line with one mark hanging open.
const unwrapped = (line: string): string => {
	// A marker that ended the line leaves its full stop behind the closing
	// mark; a page's own sentence ends inside the marks.
	const body = line.endsWith('.') ? line.slice(0, -1) : line
	for (const [opening, closing] of WRAPPING_MARKS) {
		if (
			body.length > opening.length + closing.length &&
			body.startsWith(opening) &&
			body.endsWith(closing)
		) {
			const inner = body.slice(opening.length, -closing.length)
			if (!inner.includes(opening) && !inner.includes(closing))
				return inner.trim()
		}
	}
	return line
}

/** The quote as the page writes it: markers, footnotes, joiners and the marks a
 * model wrapped it in taken off. Whitespace inside is left as it stands. */
export const cleanQuote = (quote: string): string =>
	unwrapped(
		quote
			.replace(ZERO_WIDTH, '')
			.replace(SOURCE_MARKER, '')
			.replace(FOOTNOTE, '')
			.trim(),
	)

export interface TidyQuotesResult {
	readonly findings: unknown
	/** Quotes whose text changed — a marker, a footnote or a wrapping came off. */
	readonly cleaned: number
}

const QUOTE_KEYS: ReadonlySet<string> = new Set(['quote', 'evidence_quote'])

/**
 * The findings with every quote tidied, the same object where none needed
 * it. The walk is structural: quotes sit at a different depth in every
 * findings shape.
 */
export const tidyQuotes = (findings: unknown): TidyQuotesResult => {
	let cleaned = 0

	const walk = (value: unknown): unknown => {
		if (Array.isArray(value)) {
			let changed = false
			const walked = value.map(item => {
				const next = walk(item)
				if (next !== item) changed = true
				return next
			})
			return changed ? walked : value
		}
		if (isPlainObject(value)) {
			let changed = false
			const entries = Object.entries(value).map(([key, held]) => {
				const next =
					QUOTE_KEYS.has(key) && typeof held === 'string'
						? cleanQuote(held)
						: walk(held)
				if (next !== held) {
					changed = true
					if (QUOTE_KEYS.has(key)) cleaned++
				}
				return [key, next] as const
			})
			return changed ? Object.fromEntries(entries) : value
		}
		return value
	}

	return { findings: walk(findings), cleaned }
}
