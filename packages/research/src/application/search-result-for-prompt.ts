/**
 * What a web search adds to the searching model's prompt.
 *
 * Some vendors send a long passage of each page along with the results — one
 * search has come back at over fifty thousand characters — and every character
 * handed to the searching model stays in its prompt for the rest of the pass, so
 * a pass given the passages whole fills its prompt in three rounds and stops
 * before it has opened much of anything. The prompt gets a shorter copy: where
 * each result is, what it is called, and how it opens. The answer itself is left
 * exactly as it arrived, because a passage counts the same as having opened the
 * page and the checks that run afterwards read it whole.
 *
 * The passages share one allowance per answer rather than each being cut to a
 * fixed length: an answer of three results, whose passages a run often reads
 * instead of opening the pages, should keep most of what they said, while a list
 * of twenty is where the cutting is needed.
 */
import type { Response } from 'effect/unstable/ai'

import { isPlainObject } from './guard-shapes'

/** How much of a result's summary line the searching model is shown. */
export const PROMPT_SNIPPET_CHARS = 300

/** How much page passage one search's answer may add to the prompt, all results together. */
export const PROMPT_PASSAGES_CHARS_PER_ANSWER = 6000

/**
 * The least of its passage a result is shown. Once the allowance cannot give
 * another result this much, the results after it go without a passage — their
 * address, title and summary line still say what they are.
 */
export const PROMPT_PASSAGE_MIN_CHARS = 300

/** How many results an answer can show a passage of. */
export const MAX_PROMPT_PASSAGES = Math.floor(
	PROMPT_PASSAGES_CHARS_PER_ANSWER / PROMPT_PASSAGE_MIN_CHARS,
)

const SEARCH_TOOL = 'web_search'

const opening = (text: unknown, maxChars: number): string | undefined => {
	if (typeof text !== 'string') return undefined
	return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

const hasPassage = (item: unknown): boolean =>
	isPlainObject(item) && typeof item['content'] === 'string'

/** What each result's passage may run to when `passages` results share the allowance. */
export const passageShare = (passages: number): number =>
	Math.floor(
		PROMPT_PASSAGES_CHARS_PER_ANSWER /
			Math.min(MAX_PROMPT_PASSAGES, Math.max(1, passages)),
	)

// `passageChars` is what this result's passage may run to, or nothing when the
// allowance was spent on the results before it.
const itemForPrompt = (
	item: unknown,
	passageChars: number | undefined,
): unknown => {
	if (!isPlainObject(item)) return item
	const { content: passage, ...rest } = item
	const snippet = opening(item['snippet'], PROMPT_SNIPPET_CHARS)
	const content =
		passageChars === undefined ? undefined : opening(passage, passageChars)
	return {
		...(typeof passage === 'string' ? rest : item),
		...(snippet === undefined ? {} : { snippet }),
		...(content === undefined ? {} : { content }),
	}
}

/**
 * A search's answer with every result's text cut to its opening. Anything that
 * is not the list of results a search hands back is returned as it came — a
 * refusal, an error's words, a shape this build does not know.
 */
export const searchResultForPrompt = (encoded: unknown): unknown => {
	if (!isPlainObject(encoded) || !Array.isArray(encoded['items']))
		return encoded
	const items = encoded['items']
	const passageChars = passageShare(items.filter(hasPassage).length)
	let passagesShown = 0
	return {
		...encoded,
		items: items.map(item => {
			if (!hasPassage(item)) return itemForPrompt(item, undefined)
			passagesShown += 1
			return itemForPrompt(
				item,
				passagesShown <= MAX_PROMPT_PASSAGES ? passageChars : undefined,
			)
		}),
	}
}

/**
 * A round's reply as the next round's prompt should carry it: every part as it
 * came, except that a search's answer is the shorter copy. The parts handed in
 * are never touched — the same objects are read afterwards for the pages and
 * passages the run has seen.
 */
export const responsePartsForPrompt = (
	parts: ReadonlyArray<Response.AnyPart>,
): ReadonlyArray<Response.AnyPart> =>
	parts.map(part =>
		part.type === 'tool-result' && part.name === SEARCH_TOOL && !part.isFailure
			? { ...part, encodedResult: searchResultForPrompt(part.encodedResult) }
			: part,
	)

/**
 * How much a round's reply adds to the prompt, in characters. A tool's answer is
 * counted once, as the text the prompt takes — the part holds it twice over, as
 * the value the run reads and as the text the model is sent.
 */
export const promptCharsOf = (parts: ReadonlyArray<Response.AnyPart>): number =>
	parts.reduce((total, part) => {
		if (part.type !== 'tool-result') return total + JSON.stringify(part).length
		const { result: _valueTheRunReads, ...sent } = part
		return total + JSON.stringify(sent).length
	}, 0)
