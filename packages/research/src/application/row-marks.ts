/**
 * What a guard can conclude about one row of a scan's answer, as words rather
 * than sentences.
 *
 * A mark is a word so the reader is told in their own language rather than in
 * whatever language the run happened to answer in — the guard states the finding
 * and the surface reading it writes the sentence.
 *
 * They live in a file of their own, with nothing imported into it, because the
 * web app reads them. A constant reached through the guard that writes it drags
 * that guard's whole import graph into the browser — for the place check that
 * meant `node:crypto` and `node:url`, neither of which exists there — so the
 * words are kept where anything can read them cheaply.
 */

/**
 * The key a guard-written mark is added to.
 *
 * A list rather than a field per mark. The one that came before this
 * (`unconfirmed_evidence`) is a single value read by exact match, and a second
 * one beside it would have meant a row that is two things at once quietly losing
 * whichever mark was written first. It also ends the tax every new mark
 * otherwise carries — a constant, an export, a field, a flag, a badge, and a
 * sentence in each language.
 */
export const MARKS_FIELD = 'marks'

/** The evidence puts this company somewhere other than the area asked about. */
export const OUTSIDE_REQUESTED_PLACE = 'outside_requested_place'

/**
 * Where the run's own words about that go. Its own field, because a mark is a
 * word and the reason is a sentence the run wrote; absent when the run had no
 * words to offer, so the surface can say it in the reader's language instead.
 */
export const OUTSIDE_PLACE_REASON_FIELD = 'outside_place_reason'
