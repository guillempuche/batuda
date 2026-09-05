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

/**
 * The run could not establish that this is a real, trading company.
 *
 * A mark rather than a verdict field, and only on the doubtful row: there is no
 * "confirmed" word on the wire at all, because the run cannot support one. Two
 * independent websites naming a company, one of them established as its own, is
 * what a confirmed row rested on — a good reason to stop doubting, and not a
 * claim that the company is real, still trading, or anywhere near the place the
 * request asked about. A reader handed the word "confirmed" hears all three.
 */
export const EXISTENCE_UNCONFIRMED = 'existence_unconfirmed'

/**
 * What was missing, as one of the check's own words rather than a sentence, so
 * the surface says it in the reader's language.
 */
export const EXISTENCE_REASON_FIELD = 'existence_reason'

/**
 * Every word that field may carry.
 *
 * A record rather than a list, so the type below can be derived from it and each
 * word can carry its own note. A surface that keys a sentence table off that type
 * then fails to build when a word is added here with nothing to say for it.
 *
 * The split down the middle is the part a reader has to be able to make: the
 * first three are findings about the company, and the last three are facts about
 * the run. A run that stopped paying has learned nothing at all about the
 * company, and a reader who cannot tell that from `no_own_site` reads a run that
 * never looked as a run that looked and came back empty.
 */
export const EXISTENCE_REASONS = {
	/** Nothing usable named the company at all. */
	no_sources: true,
	/** Only one website named it, however many pages of it were read. */
	one_website: true,
	/** Two or more websites named it, none established as the company's own. */
	no_own_site: true,
	/** The run ran out of its verification allowance before reaching this row. */
	budget_exhausted: true,
	/** The run ran out of time before reaching this row. */
	deadline_reached: true,
	/** The check could not run — a search provider that was down or errored. */
	checker_unavailable: true,
} as const

/** Why a company is only a candidate. */
export type CandidateReason = keyof typeof EXISTENCE_REASONS

/**
 * Whether a stored row's reason is one of the words above.
 *
 * Stored findings are read back as `unknown`, and a run written by an older
 * pass — or by a later one that adds a word this reader does not have — can
 * carry anything. Asking rather than asserting is what keeps a surface from
 * being handed a word it has no sentence for.
 */
export const isCandidateReason = (value: unknown): value is CandidateReason =>
	typeof value === 'string' && Object.hasOwn(EXISTENCE_REASONS, value)

/**
 * How many independent websites named the company.
 *
 * Written on every row the check reached, doubted or not, and that is what makes
 * the doubt readable at all: with only a mark to go on, a row nobody judged and
 * a row judged and found sound are the same row — both carry nothing. The count
 * says the check ran. A row with this and no mark is one the run stopped
 * doubting; a row with neither was never reached.
 *
 * It is also the evidence a reader wants either way: three websites naming a
 * company is worth knowing when the answer is "no doubt" as much as when it is
 * "not enough".
 */
export const WEBSITES_SEEN_FIELD = 'websites_seen'
