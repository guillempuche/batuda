/**
 * What every guard that puts a scan's rows to a model needs, in one place.
 *
 * Two of them exist — one asks what kind of organisation a row is, the other
 * where the company is — and a third is only ever a question away. They ask
 * different things and share a shape: cut the list into questions small enough
 * to answer, tie each answer back to the row it is about, and remember what was
 * bought so the next pass over a list that barely changed does not buy it again.
 *
 * Held together because the pieces below are not incidental likeness. Two copies
 * of the fold that decides which rows are one company let two guards disagree
 * about that, and the de-duplication link folds on the same key — so all three
 * have to move together or none of them does. Two copies of a field reader let
 * one go quiet the day a field starts naming the page it was read on, which is
 * exactly how four readers of a company's web address spent three weeks
 * answering "nothing here".
 */

import { foldReadsEveryLetter, nameCore, withoutFormDots } from './entity-guard'
import { readTextValue } from './guard-shapes'

/**
 * How many rows go in one question.
 *
 * A whole market list in one prompt is how a check like this comes to be skipped
 * on exactly the lists it is for: a live Spanish market came back with 66 rows,
 * each carrying a rationale, a description and a trade, and the longest lists are
 * both the most likely to outgrow the model's window and the most likely to be
 * holding something worth catching. A call that outgrows it fails, and a failed
 * call keeps every row.
 */
export const JUDGE_BATCH_ROWS = 25

/**
 * How much of a row's own words are shown. Enough to say what an organisation is
 * or where it claims to be — both announce themselves in a first sentence —
 * while a row carrying a scraped page's worth of prose cannot spend the whole
 * window on itself.
 */
export const JUDGE_DESCRIPTION_CHARS = 300

/**
 * What a row is remembered under: the company itself, folded the way the rest of
 * this package folds a company's name.
 *
 * A question about an ORGANISATION is answered about the organisation, not about
 * the sentence a pass happened to write around it. Remembering it under the words
 * instead lets an answer be undone by a re-wording — a scan re-reads its list
 * several times and writes the rationale afresh each time.
 *
 * Folded with `nameCore`, which is what the de-duplication link folds rows onto
 * one company by. Two keys for one question would let a guard and that link
 * disagree about whether two rows are the same company.
 *
 * Nothing to fold on gives no key, and a row with no key is asked about every
 * time rather than filed under the empty string beside every other nameless row.
 */
export const judgedRowKey = (name: string): string | undefined => {
	// A name written in a script the fold has no letters for comes back as
	// whatever Latin sat beside it, which is not this company and may well be
	// another's whole key.
	if (!foldReadsEveryLetter(name)) return undefined
	// The dots come out before the fold, or a form written "S.L." survives it as
	// two stray letters and "URANOGAS S.L." files apart from "Uranogas SL" — two
	// spellings of one company on one list is the ordinary case here, not an
	// exotic one. `coreSpellings` folds in that order for the same reason.
	const core = nameCore(withoutFormDots(name))
	return core === '' ? undefined : core
}

/**
 * The rows in runs of at most `size`. An empty list gives no runs, so a caller
 * with nothing to ask makes no call.
 */
export const judgeBatches = <A>(
	items: ReadonlyArray<A>,
	size: number,
): ReadonlyArray<ReadonlyArray<A>> => {
	const out: Array<ReadonlyArray<A>> = []
	for (let at = 0; at < items.length; at += size)
		out.push(items.slice(at, at + size))
	return out
}

/**
 * One field of a row as text, read past the page it was written with when it
 * carries one. Empty when the field holds nothing usable.
 *
 * Reading past the pairing matters even where a field is a plain string today:
 * the day it gains its source, a reader that only understood plain strings goes
 * quiet rather than wrong, and nothing reports it.
 */
export const judgedRowText = (
	row: Record<string, unknown>,
	field: string,
): string => readTextValue(row[field])?.trim() ?? ''
