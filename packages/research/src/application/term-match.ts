/**
 * Whether a wording appears in a piece of text.
 *
 * One reading, shared: a run checks here whether it answered every part of what it
 * was asked, and the eval counts how many parts it answered off the same code. Two
 * copies would drift, and a run reporting a trade answered that the eval reads as
 * missed makes the before-and-after figures stop being about the same thing.
 */

/** A value with its accents taken off, so "Instalación" and "instalacion" are one word. */
export const foldDiacritics = (value: string): string =>
	value.normalize('NFD').replace(/\p{Diacritic}/gu, '')

/**
 * A value's words with the accents taken off, so punctuation between two words
 * never runs them into one.
 *
 * Exported so the golden data can be held to the same reading: a wording that folds
 * to no words can never place a row or name an organisation, and refusing it where it
 * is written beats accepting it and silently measuring nothing.
 */
export const termTokens = (value: string): ReadonlyArray<string> =>
	foldDiacritics(value)
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(token => token.length > 0)

// Below this length a term's word has to match a whole word. A three-letter word is
// the opening of far too many unrelated ones — "gas" starts "gasto" — while a longer
// one is long enough that only its own endings follow it, so "instalacion electrica"
// reaches "instalaciones eléctricas" without every ending of every trade in every
// language being listed.
const TERM_PREFIX_MIN_CHARS = 5

// Whether a term's words appear among a text's words, in order and next to each
// other. A long enough word matches as an opening, because Spanish, Catalan and
// French put an ending on every word of a phrase, not only on the last one.
const termAppearsIn = (
	term: ReadonlyArray<string>,
	words: ReadonlyArray<string>,
): boolean => {
	if (term.length === 0) return false
	for (let at = 0; at + term.length <= words.length; at++) {
		const matches = term.every((token, offset) => {
			const word = words[at + offset] ?? ''
			return token.length >= TERM_PREFIX_MIN_CHARS
				? word.startsWith(token)
				: word === token
		})
		if (matches) return true
	}
	return false
}

/**
 * Whether any of these wordings appears in any of these texts.
 *
 * The texts come in already split into words, because a caller asks about the same
 * rows once per part, and splitting them again would repeat that work every time.
 */
export const anyTermAppearsIn = (
	terms: ReadonlyArray<string>,
	texts: ReadonlyArray<ReadonlyArray<string>>,
): boolean =>
	terms.some(term => {
		const tokens = termTokens(term)
		return texts.some(words => termAppearsIn(tokens, words))
	})
