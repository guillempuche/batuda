/**
 * Whether a wording appears in a piece of text.
 *
 * One reading, shared: a run checks here whether it answered every part of what it
 * was asked, and the eval counts how many parts it answered off the same code. Two
 * copies would drift, and a run reporting a trade answered that the eval reads as
 * missed makes the before-and-after figures stop being about the same thing.
 *
 * ## Words, and the writing systems that do not have them
 *
 * Most writing puts a space between one word and the next, and this file's whole
 * reading is built on that: it compares a term's words against a text's words. Han,
 * kana, Thai, Lao, Khmer and Burmese do not — a Chinese sentence is a run of
 * characters with nothing between them — so there are no words to compare and the
 * reading came back empty for every one of them. Empty is read by callers as "this
 * wording says nothing", which is how a request written in Chinese produced no parts
 * at all and the whole coverage mechanism went dark for that market.
 *
 * So the writing system decides which reading applies: a term written with word
 * spaces is matched word by word, and one written without is looked for as a run of
 * characters inside the text. Neither is a good reading of the other — matching
 * "logistica" anywhere inside a text would hit "logisticamente", and asking Chinese
 * for whole words asks for something the writing does not have.
 */

import { EQUIVALENT_LETTERS } from '@batuda/domain'

const LETTERS_TO_REWRITE = new RegExp(
	`[${[...EQUIVALENT_LETTERS.keys()].join('')}]`,
	'gu',
)

/** A value with its accents taken off, so "Instalación" and "instalacion" are one word. */
export const foldDiacritics = (value: string): string =>
	value.normalize('NFD').replace(/\p{Diacritic}/gu, '')

// A letter outside a-z written as the plain letters it stands for, because a
// company spells it that way itself: Straßenbau registers strassenbau.de. Taking
// the mark off never reaches these — they are single letters rather than a letter
// with something added — so before this they were dropped as punctuation and
// "Straße" was read as the two words "stra" and "e".
//
// Korean is put back together at the end. Taking accents off starts by pulling
// every letter apart into the pieces it is built from, and a Korean letter is
// built from two or three of them — so left there, a name comes back as pieces
// nobody typing it would produce, and it matches only another copy of itself.
const inPlainLetters = (value: string): string =>
	foldDiacritics(value)
		.toLowerCase()
		.replace(
			LETTERS_TO_REWRITE,
			letter => EQUIVALENT_LETTERS.get(letter) ?? letter,
		)
		.normalize('NFC')

// The writing systems that run their words together. A term in one of these is
// looked for as a run of characters, because it has no words to look for.
//
// Korean is deliberately absent: it is written with spaces between its words, so it
// reads as words like Latin or Cyrillic does.
const WRITES_WITHOUT_WORD_SPACES =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u

/**
 * Whether a piece of text is written in a system that puts no space between one
 * word and the next.
 *
 * Shared because every reading built on words has to ask it: how long a word has to
 * be before it means anything, and whether there are words at all, are both decided
 * by this and not by the reader.
 */
export const writtenWithoutWordSpaces = (value: string): boolean =>
	WRITES_WITHOUT_WORD_SPACES.test(value)

const wordsOf = (plain: string): ReadonlyArray<string> =>
	plain.split(/[^\p{L}\p{N}]+/u).filter(token => token.length > 0)

/**
 * A value's words with the accents taken off, so punctuation between two words
 * never runs them into one.
 *
 * Every writing system's letters count, not only a-z. Holding to a-z meant a term
 * in Chinese, Cyrillic, Arabic or Thai produced no words at all, and a wording that
 * produces no words is refused by every caller here — so those markets were not
 * measured badly, they were not measured.
 *
 * Exported so the golden data can be held to the same reading: a wording that folds
 * to no words can never place a row or name an organisation, and refusing it where it
 * is written beats accepting it and silently measuring nothing.
 */
export const termTokens = (value: string): ReadonlyArray<string> =>
	wordsOf(inPlainLetters(value))

// Below this length a term's word has to match a whole word. A three-letter word is
// the opening of far too many unrelated ones — "gas" starts "gasto" — while a longer
// one is long enough that only its own endings follow it, so "instalacion electrica"
// reaches "instalaciones eléctricas" without every ending of every trade in every
// language being listed.
const TERM_PREFIX_MIN_CHARS = 5

// A run this short is not worth looking for inside a text. One Han character is a
// piece of far too many unrelated words to say anything about what a page is about,
// and a term that matches nothing is reported uncovered, which costs a search rather
// than claiming an answer nobody gave.
const RUN_MIN_CHARS = 2

/**
 * A text prepared for asking about repeatedly: its words, and the whole of it as one
 * run of characters.
 *
 * Both, because which one answers depends on the term rather than on the text — a
 * Chinese trade name and a Spanish one can be asked about the same page. Prepared
 * once because a caller asks about the same rows once per part of the request, and
 * doing this per question would repeat it every time.
 */
export interface ReadableText {
	readonly words: ReadonlyArray<string>
	readonly run: string
}

/** A piece of text read both ways, ready to be asked about. */
export const readText = (value: string): ReadableText => {
	const words = wordsOf(inPlainLetters(value))
	// Joined with nothing between them, so both sides of a comparison are free of
	// separators: a page writing "物流 倉庫" and a term typed "物流倉庫" are the same
	// wording, and either could be the one carrying the space.
	return { words, run: words.join('') }
}

// Whether a term's words appear among a text's words, in order and next to each
// other. A long enough word matches as an opening, because Spanish, Catalan and
// French put an ending on every word of a phrase, not only on the last one.
const termAppearsInWords = (
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
 * How one wording will be looked for, worked out once rather than once per text.
 *
 * A wording written without word spaces becomes a run of characters to find inside
 * the text; every other one becomes words to match. A wording with no letters at all
 * becomes neither, and matches nothing — an empty reading that matched everything is
 * how a part with a blank term would read answered by rows nobody checked.
 */
const readTerm = (
	term: string,
): { readonly run: string } | { readonly words: ReadonlyArray<string> } => {
	const words = termTokens(term)
	if (!WRITES_WITHOUT_WORD_SPACES.test(term)) return { words }
	const run = words.join('')
	return { run: run.length >= RUN_MIN_CHARS ? run : '' }
}

/** Whether any of these wordings appears in any of these texts. */
export const anyTermAppearsIn = (
	terms: ReadonlyArray<string>,
	texts: ReadonlyArray<ReadableText>,
): boolean =>
	terms.some(term => {
		const reading = readTerm(term)
		if ('run' in reading) {
			return (
				reading.run !== '' && texts.some(text => text.run.includes(reading.run))
			)
		}
		return texts.some(text => termAppearsInWords(reading.words, text.words))
	})
