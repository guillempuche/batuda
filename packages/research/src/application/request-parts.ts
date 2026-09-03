/**
 * The parts of a request, held for the whole of a search.
 *
 * A request naming five trades is answered by companies for five trades, not by
 * sixty companies for one of them. Telling the search so is not enough on its own: a
 * run that covers one trade and stops looks, from its own count, exactly like one
 * that covered them all, and the person reading the list cannot tell "this market
 * only has electricians" from "the search stopped after electricians".
 *
 * So the request is split into its parts before any searching starts, the list is
 * carried into every pass, and what came back is held against it at the end: a part
 * nothing answers sends the search back out for that part specifically, and one
 * still unanswered when the run finishes is named in what the run reports rather
 * than passed over in silence. Nothing here promises to find companies that are not
 * findable — a market with no lift installers online should say it could not cover
 * lifts, which is a good answer.
 *
 * The two do not read the same list. Going back out is decided over what has been
 * gathered so far; the report is held against the list the run finally hands
 * back — a second reading of the same pages wherever the search is pinned to a
 * company. So a part can be answered when the decision is taken and empty by the
 * time it is reported, which is why the report names the parts nothing ever went
 * looking for instead of letting them read as searches that came back empty.
 *
 * What counts as a part: a kind of company the request asks for — a trade, a
 * sector, a speciality. Not a place. A row says what it does in the words of its
 * trade and says where it is in a field of its own, so a province read against the
 * same words would come back uncovered on every row that answers it.
 *
 * Read the caveat on the fields `discoveryRowText` reads before treating a coverage
 * reading as a score: a row can repeat the request back, so a part reads as covered
 * generously. That is why a part that goes unanswered is what drives anything here,
 * and why the follow-up asks for companies rather than for better descriptions of
 * the ones already listed.
 */

import { Schema } from 'effect'

import { foldLabel } from '@batuda/domain'

import { discoveryRowText } from './discovery-scan'
import { anyTermAppearsIn, readText, termTokens } from './term-match'

/** One kind of company a request asks for, and the wordings that place a row in it. */
export interface RequestPart {
	/** The kind of company, in the words the request itself used. */
	readonly label: string
	/** Other wordings that place a row in this part, in whichever languages the market answers in. */
	readonly terms: ReadonlyArray<string>
}

/** Which of a request's parts came back with companies, and which did not. */
export interface RequestCoverage {
	readonly covered: ReadonlyArray<string>
	readonly uncovered: ReadonlyArray<string>
	/**
	 * Of the ones nothing answered, those no pass ever went looking for. Reported
	 * apart because "the search found nobody" and "the search never looked" are
	 * different answers, and only the first says anything about the market.
	 */
	readonly unsearched: ReadonlyArray<string>
}

/**
 * Below this many parts there is nothing to work through: a request naming one kind
 * of company is answered by companies of that kind, which every other signal already
 * judges. Asking about coverage there would turn "no row happened to name the trade"
 * into a shortfall of its own on runs that are perfectly fine.
 */
const MIN_COVERAGE_PARTS = 2

/**
 * A request that names more kinds of company than this was not split, it was
 * shredded — the likeliest cause is one kind broken into the words it is made of.
 * The first few are kept rather than the whole thing thrown away, so a genuinely
 * long request still gets worked through as far as this.
 */
export const MAX_REQUEST_PARTS = 12

/** Wordings kept per part. More than this is a model listing every phrasing it can think of. */
export const MAX_PART_TERMS = 12

/**
 * How many words for a KIND of company are kept. A language has a handful — group,
 * holding, services, and the local words beside them. A list longer than this is a
 * model reaching past what its language actually uses, and every word on it takes a
 * real word away from the firms genuinely called it.
 */
export const MAX_KINDS_OF_COMPANY = 16

/**
 * Shortest a word for a kind of company may be, counted in the letters a web address
 * carries. These words are spent saying a name word identifies nobody, and a two- or
 * three-letter one strips far more names than it was meant to — "sa" would take the
 * front off half a French list. Set where a word is long enough to be a word rather
 * than an initial.
 *
 * It is a floor on LETTERS, which is the only thing the fold these words are read
 * against keeps ("集团" is a whole word in two characters). That costs nothing today,
 * because a name written in those characters folds to nothing and no reading here
 * reaches it either way — see `entity-guard.ts`.
 */
export const SHORTEST_KIND_OF_COMPANY = 4

/**
 * Longest a wording may be. A trade is named in a few words; anything past this is
 * a paragraph where a name was asked for. It matters because these words go into
 * every searching pass's prompt — an unbounded one would fill the prompt on its own
 * and stop the search after a single round.
 */
export const MAX_WORDING_CHARS = 80

/**
 * How many extra searching passes a request's unanswered parts are worth.
 *
 * Two was set for a request naming a trade or two, where the first pass does the
 * work and the second reaches what it missed. A request naming nine trades gets
 * the same two, and a run that asked for nine came back having covered one of
 * them, from 139 pages read — the parts it never searched for were not a market
 * with nobody in it, they were a plan it was stopped part-way through. Four is
 * enough for a request of that width and still bounded by the clock and the money
 * below, which are the limits that should decide when to stop.
 */
export const MAX_COVERAGE_PASSES = 4

/**
 * And no pass starts once this much of the run's clock is gone. A whole-market
 * search already runs a good share of its deadline, and a pass that overruns it
 * takes the run down with it — the deadline marks the run failed, which loses the
 * companies it did find. Half the clock left is the room another pass plus the
 * extraction, the gap rounds and the brief after it need.
 */
const COVERAGE_PASS_DEADLINE_FRACTION = 0.5

/**
 * Why the search is, or is not, going back out for the parts nothing answered.
 *
 * All but `provider_failed` are decided before a pass goes out; that one is only
 * known afterwards, when the pass went out and the provider would not answer it.
 */
export type CoveragePassVerdict =
	| 'go'
	| 'answered'
	| 'passes_spent'
	| 'deadline_margin'
	| 'budget_margin'
	| 'provider_failed'

/**
 * Whether to spend another searching pass on the parts nothing came back for.
 *
 * A part left unanswered because the clock or the money ran out is still reported as
 * unanswered, so stopping here costs the reader nothing they would not otherwise be
 * told — where overrunning the deadline costs them the whole run.
 */
export const coveragePassVerdict = (args: {
	readonly uncovered: number
	readonly passesSpent: number
	readonly elapsedMs: number
	readonly deadlineMs: number
	readonly canAfford: boolean
}): CoveragePassVerdict => {
	if (args.uncovered === 0) return 'answered'
	if (args.passesSpent >= MAX_COVERAGE_PASSES) return 'passes_spent'
	if (args.elapsedMs > args.deadlineMs * COVERAGE_PASS_DEADLINE_FRACTION)
		return 'deadline_margin'
	if (!args.canAfford) return 'budget_margin'
	return 'go'
}

// The shape the splitter is asked to fill — passed to generateObject and named in
// the prompt too, per the extract tier's schema-in-both-places rule.
export const RequestPartsSchema = Schema.Struct({
	parts: Schema.Array(
		Schema.Struct({
			label: Schema.String,
			terms: Schema.Array(Schema.String),
		}),
	),
	kindsOfCompany: Schema.Array(Schema.String),
	// Required and often empty rather than left out: a strict provider reads an
	// absent key and a key holding nothing as two different answers, and only one
	// of them is a request that named no place.
	place: Schema.String,
})

/**
 * What the splitter is asked. It runs before any searching, so all it has to read
 * is the request itself.
 */
export const requestPartsPrompt = (query: string): string =>
	[
		'You are reading one research request and listing the kinds of company it asks for.',
		'',
		'A part is one kind of company the request names — a trade, a sector, a speciality, a line of work. Where the request names one kind of company, return exactly one part. Never split a single kind into the words it is made of ("industrial refrigeration" is one part, not "industrial" and "refrigeration"), and never add a kind the request does not name.',
		'Where two wordings sit either side of an "and", settle this before anything else: do they name the same work? Two words for one trade are one part, whatever joins them — a request naming a trade in both the local word and the ordinary one, or in two languages, is asking for one kind of company, and the second wording goes among that part\'s terms rather than becoming a part of its own. A trade whose own name contains the word is the same case: health and safety is one line of work, not two.',
		'Only where the two really are different work does it matter where the "and" sits. A request that lists its trades separated by commas closes that list with an "and", and that last one is the list\'s own punctuation: it separates the final trade from the one before it, so they are two parts — fire protection and lifts, closing such a list, are two. An "and" inside one of the earlier items is joining two words within a single item, so ask whether one firm ordinarily does both: plumbing and heating, sitting mid-list, is one part, because the firms that do one do the other and asking separately would ask twice for the same companies.',
		'A place is not a part. A request for companies across a country, a region, or a list of provinces still asks for one kind of company per trade it names; leave the places out of the parts and give the place separately, below.',
		'A request that names no kind of company at all — one that names a single company and asks who competes with it, or who resembles it — has no parts. Return an empty list for it rather than guessing at the trades that company might be in.',
		'',
		'For each part:',
		'- label: the kind of company in the words the request itself uses, a few words at most.',
		'- terms: other wordings that would place a company in this part — the ordinary word for the trade, and for someone who does it — in the language of the request, in the language of the country it is about, and in English. Between 3 and 10 of them. A wording that would fit a company in another part just as well belongs to neither: leave it out.',
		'',
		'Return the parts in the order the request names them.',
		'',
		'Separately, list the words a COMPANY NAME uses to say what kind of company it is rather than which company it is — group, holding, services, associates and the like. Give them in the language of the request, in the language of the country it is about, and in English, in the plural and singular forms a name actually writes. "Grup Puig" is a firm called Puig, so "grup" belongs on this list; "Puig" never does.',
		'These are words for a KIND of company, never for a trade and never for a place: plumbing, lifts, Barcelona and France are all wrong here. A family name, a coined name or a brand is wrong here too, and putting one on this list takes its own name away from every firm called it — so leave out anything you are not sure of. Between 4 and 12 words. Return an empty list rather than guessing at a language you cannot place.',
		'',
		'Separately again, name the place the request wants its companies to BE IN, in the words the request uses ("Ripollet (Barcelona)", "Texas", "Baltimore metro"). Only where the request confines its answer to a place: a company named in passing, a place it sells into or travels to, and the country a language happens to belong to are all somewhere a company is not required to be, and each of them is an empty answer. Where the request names several, give the widest one that contains them all. Answer with an empty string whenever the request asks for companies anywhere.',
		'',
		'Return {"parts": [{"label": "...", "terms": ["...", "..."]}], "kindsOfCompany": ["...", "..."], "place": "..."} and nothing else.',
		'',
		`Request:\n${query}`,
	].join('\n')

/**
 * A wording trimmed and cut to a name's length, or null when it says nothing that
 * could ever place a row. Cutting rather than refusing keeps a part whose label came
 * back overlong: its first words are still the trade's name.
 */
const readWording = (raw: unknown): string | null => {
	if (typeof raw !== 'string') return null
	const wording = raw.trim().slice(0, MAX_WORDING_CHARS).trim()
	return termTokens(wording).length === 0 ? null : wording
}

/**
 * Drop any wording that two parts both claim.
 *
 * A word both the electrical part and the plumbing part list — "instalación" — places
 * a row in neither, and left in it would mark every part covered off the first row
 * that came back. A part's own label is never dropped, because a part with no wording
 * at all could only read as uncovered for the rest of the run.
 */
const dropSharedWordings = (
	parts: ReadonlyArray<{ label: string; terms: ReadonlyArray<string> }>,
): ReadonlyArray<RequestPart> => {
	const claims = new Map<string, number>()
	for (const part of parts) {
		for (const wording of [part.label, ...part.terms]) {
			const key = foldLabel(wording)
			claims.set(key, (claims.get(key) ?? 0) + 1)
		}
	}
	return parts.map(part => ({
		label: part.label,
		terms: part.terms.filter(term => (claims.get(foldLabel(term)) ?? 0) < 2),
	}))
}

/**
 * The splitter's answer, read into the list the run will hold.
 *
 * Takes whatever came back rather than a decoded value: a model can answer with the
 * wrong shape, and a search that then refuses to start would be a worse run than one
 * that goes ahead with no list at all. Anything unreadable comes back empty, which
 * turns coverage off for that run and leaves every other signal as it was.
 */
export const readRequestParts = (raw: unknown): ReadonlyArray<RequestPart> => {
	if (raw === null || typeof raw !== 'object') return []
	const entries = (raw as { parts?: unknown }).parts
	if (!Array.isArray(entries)) return []

	const parts: Array<{ label: string; terms: string[] }> = []
	const seenLabels = new Set<string>()
	for (const entry of entries) {
		if (parts.length >= MAX_REQUEST_PARTS) break
		if (entry === null || typeof entry !== 'object') continue
		// A label that folds to no words can never place a row, so a part carrying
		// one could only ever read as uncovered.
		const label = readWording((entry as { label?: unknown }).label)
		if (label === null) continue
		const key = foldLabel(label)
		if (seenLabels.has(key)) continue
		seenLabels.add(key)

		const rawTerms = (entry as { terms?: unknown }).terms
		const terms: string[] = []
		const seenTerms = new Set<string>([key])
		if (Array.isArray(rawTerms)) {
			for (const rawTerm of rawTerms) {
				if (terms.length >= MAX_PART_TERMS) break
				const term = readWording(rawTerm)
				if (term === null) continue
				const termKey = foldLabel(term)
				if (seenTerms.has(termKey)) continue
				seenTerms.add(termKey)
				terms.push(term)
			}
		}
		parts.push({ label, terms })
	}

	return dropSharedWordings(parts)
}

/**
 * The words the run was told name a KIND of company, read off the same answer the
 * parts come from.
 *
 * Read apart from the parts because a part is something the run goes looking for and
 * these are not: nothing searches for "group". They are spent on one thing, telling
 * a company's own word from the word saying what sort of thing it is, so a request
 * that came back without them leaves that reading exactly as the shared list had it.
 *
 * Short words are dropped rather than trusted. These are spent saying a name's word
 * identifies nobody, so a wrong one costs a real firm its own name — and the shorter
 * the word, the more names it reaches. A wrong one can only ever withhold, never
 * reach a name: `run-words.ts` keeps these out of the reading that cuts the front off
 * a domain, because they come from a model reading a language rather than from
 * anything the person who asked actually wrote.
 *
 * A word in a writing system the fold has no letters for is dropped with them, and
 * silently, because nothing downstream could have used it: a name in that writing
 * folds to nothing too, so there would be nothing for the word to be read against.
 */
export const readKindsOfCompany = (raw: unknown): ReadonlyArray<string> => {
	if (raw === null || typeof raw !== 'object') return []
	const listed = (raw as { kindsOfCompany?: unknown }).kindsOfCompany
	if (!Array.isArray(listed)) return []

	const kinds: Array<string> = []
	const seen = new Set<string>()
	for (const entry of listed) {
		if (kinds.length >= MAX_KINDS_OF_COMPANY) break
		const word = readWording(entry)
		if (word === null || word.length < SHORTEST_KIND_OF_COMPANY) continue
		const key = foldLabel(word)
		if (seen.has(key)) continue
		seen.add(key)
		kinds.push(word)
	}
	return kinds
}

/**
 * The place the request confines its answer to, read off the same answer.
 *
 * Empty for a request that asks for companies anywhere, and empty again for
 * anything unreadable — which is the same answer the run gave itself before this
 * was asked, so nothing is worse off for a splitter that fumbles it.
 *
 * It is only ever read as a place to hold an answer AGAINST. What a run spends
 * money searching for stays the caller's own `hints.place`, which is a filter the
 * caller asked for; this is the run reading the request back to itself, and a
 * place it read wrongly would otherwise send every search somewhere nobody asked
 * about.
 */
export const readRequestPlace = (raw: unknown): string => {
	if (raw === null || typeof raw !== 'object') return ''
	return readWording((raw as { place?: unknown }).place) ?? ''
}

/**
 * Which of the request's parts the rows that came back answer, or null when the
 * request named too few parts for the question to mean anything.
 *
 * `searched` is the parts a pass went back out for, which the rows cannot say on
 * their own: a part can end up empty with no pass ever spent on it, either from the
 * two readings this file opens with disagreeing, or from the clock or the money
 * stopping a pass before it ran.
 */
export const coverRequestParts = (
	parts: ReadonlyArray<RequestPart>,
	rows: ReadonlyArray<Record<string, unknown>>,
	searched: ReadonlySet<string>,
): RequestCoverage | null => {
	if (parts.length < MIN_COVERAGE_PARTS) return null
	const rowTexts = rows.map(row => readText(discoveryRowText(row)))
	const covered: string[] = []
	const uncovered: string[] = []
	const unsearched: string[] = []
	for (const part of parts) {
		if (anyTermAppearsIn([part.label, ...part.terms], rowTexts)) {
			covered.push(part.label)
		} else {
			uncovered.push(part.label)
			if (!searched.has(part.label)) unsearched.push(part.label)
		}
	}
	return { covered, uncovered, unsearched }
}

/**
 * The parts a search went out for and still came back empty on.
 *
 * These are the only ones anything may say it found nobody for. A part nothing
 * looked for is left out rather than named, because every wording that reports a
 * shortfall asserts a search that happened.
 */
export const searchedAndEmptyParts = (
	uncovered: ReadonlyArray<string>,
	unsearched: ReadonlyArray<string>,
): ReadonlyArray<string> =>
	uncovered.filter(label => !unsearched.includes(label))

/**
 * Of the parts nothing went looking for, those the search finished believing it
 * had already found companies for.
 *
 * This is the one reading that separates the two ways a part goes unlooked-for.
 * A part the search still knew was missing when it stopped was a decision — there
 * was no clock, no money or no pass left. A part it no longer saw as missing was
 * lost after its last look, which is the drift a run pinned to a company can have
 * between the list it decided on and the list it reports.
 *
 * Why the reason the loop stopped cannot answer this: that reason describes the
 * run, and one run can hold both cases at once — a part lost after the last look
 * beside another the clock stopped it reaching.
 */
export const partsThoughtAnswered = (
	unsearched: ReadonlyArray<string>,
	stillMissingAtTheLastLook: ReadonlyArray<string>,
): ReadonlyArray<string> =>
	unsearched.filter(label => !stillMissingAtTheLastLook.includes(label))

/** Labels quoted for a prompt, so each part is named exactly as the request wrote it. */
const listLabels = (labels: ReadonlyArray<string>): string =>
	labels.map(label => `"${label}"`).join(', ')

/**
 * The list handed to the search itself, so what it is working through is on the page
 * in front of it rather than something it was asked to keep in mind.
 *
 * Empty for a request naming one kind of company: there is no list to work through,
 * and the same threshold decides that here and where coverage is read, so the search
 * is never told to work through a list nothing will hold it to.
 */
export const requestPartsDirective = (
	parts: ReadonlyArray<RequestPart>,
): string =>
	parts.length < MIN_COVERAGE_PARTS
		? ''
		: `The request asks for ${parts.length} kinds of company: ${listLabels(parts.map(part => part.label))}. Work through them one at a time and come back with companies for every one of them — a list answering one or two of them does not answer the request, however many companies those turn up.`

/**
 * What the search is sent back out with when parts of the request have no companies
 * yet. It asks for companies rather than for better wording on purpose: a part is
 * read as answered off what the rows say, so telling the model which parts look
 * unanswered is also telling it how to look answered without finding anyone.
 */
export const uncoveredPartsDirective = (
	uncovered: ReadonlyArray<string>,
): string =>
	`Nothing you have found so far answers ${listLabels(uncovered)}. Search for each of those now, on its own: the ordinary words for that work together with the place the request named, and the business directories, association member lists and sector registries where such companies are listed. Come back with companies that actually do that work — adding the words to a company you have already listed answers nothing. Keep every qualifier the request made: size, place, and niche.`
