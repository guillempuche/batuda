/**
 * Grading a search for a whole market: what is wrong with the list that came back.
 *
 * Counting how many companies came back is not a grade — a run on 13 August returned 62
 * rows of which 23 were trade bodies and 10 were one company written twice, and four of
 * the five trades asked for were missing. So a list is read for those faults instead:
 * how many rows are the kind of organisation asked for, how many of the request's parts
 * got an answer, how many rows repeat a company already in the list, and how many say
 * where the company is.
 *
 * Repeats are counted twice over, strictly and loosely, because one figure cannot do
 * it. The strict one reuses the keys the pipeline folds on, so it says whether that
 * fold is still working and nothing more; the loose one is allowed to see repeats no
 * fold may safely act on, which is the only way a reader ever learns those keys are
 * too narrow. The gap between them is the reading.
 *
 * One company's profile is graded by eval-scoring-company.ts instead.
 */

import {
	DISTINCTIVE_NAME_LENGTH,
	nameCoreTokens,
	withoutFormDots,
} from './entity-guard'
import type { MarketPart, RunOutcome } from './eval-scoring-types'
import {
	bracketedNoteParents,
	branchOfficeParents,
	discoveryRowIdentityKeys,
	hostsEstablishedAsOwn,
} from './prospect-dedupe-guard'
import { rowGroups } from './row-groups'
import { anyTermAppearsIn, termTokens } from './term-match'
import type { TradeWords } from './trade-words'

export const partsAnsweredBy = (
	rows: RunOutcome['companies'],
	parts: ReadonlyArray<MarketPart>,
): number => {
	const rowWords = rows.map(row => termTokens(`${row.name} ${row.describedAs}`))
	return parts.filter(part => anyTermAppearsIn(part.terms, rowWords)).length
}

/**
 * Whether a row is one of the organisations the golden names as not a company.
 *
 * The listed name has to appear in the row's name as those words, in that order,
 * next to each other. A run writes a body's name longer than the golden does —
 * "FENIE — Federación Nacional de Empresarios de Instalaciones" — so the listed name
 * sitting inside the row's is what catches it.
 *
 * Whole words rather than a run of letters, because a body is usually known by its
 * initials and three letters land inside an unrelated name by accident: "RTE" sits
 * in the middle of "Norte Instalaciones", and "FFB" inside "Groupe FFBat".
 *
 * Next to each other rather than merely present, because the words of a body's name
 * are the trade's ordinary words scattered through many a company's: an unordered
 * test reads "Eléctrica del Norte, Red de Instaladores" as the grid operator. Order
 * does not save every case — a listed name short enough to sit inside a real company
 * name still matches it — which is why the golden lists the name a body is known by
 * rather than a fragment of it. And only in that direction — asking whether the row's words all
 * sit inside the listed name marks any company named after its own trade as a body,
 * from "Instalaciones y Energía" to a French "Génie Électrique et Climatique".
 * Counting a body where there is none marks a real company as the wrong kind, which
 * overstates the very problem being measured.
 *
 * Two rules on the golden data follow. List the name a body is actually known by,
 * specific enough to be its own — "Red Eléctrica" alone names half the installers in
 * the country — and list its initials as an entry of their own, because an acronym
 * shares no words with what it stands for.
 *
 * What is left over, and cannot be read off a name: a company trading under a body's
 * initials, like the retailer FENIE Energía beside the federation FENIE. It reads as
 * the body. Asking the model what an organisation is would settle it; a name cannot.
 */
export const isKnownNonCompany = (
	name: string,
	notCompanies: ReadonlyArray<string>,
): boolean => {
	const words = termTokens(name)
	return notCompanies.some(listed => {
		const listedWords = termTokens(listed)
		if (listedWords.length === 0) return false
		// A body known by its initials shares that word with the companies trading
		// under it — the retailer FENIE Energía beside the federation FENIE, Grupo
		// Unef Solar beside UNEF, RTE Ascenseurs beside the grid operator. One word
		// on its own is only conclusive when it is the whole of what the row is
		// called; spelled-out names carry enough words to be found inside a longer
		// one safely.
		if (listedWords.length === 1)
			return words.length === 1 && words[0] === listedWords[0]
		return words.some((_, at) =>
			listedWords.every((word, offset) => words[at + offset] === word),
		)
	})
}

// The fields the fold reads a row by, in the shape it reads them: the name, the
// site, and the place — a branch is told by its name ending on the town it gives.
const asDiscoveryRows = (
	rows: RunOutcome['companies'],
): ReadonlyArray<Record<string, unknown>> =>
	rows.map(row => ({
		name: row.name,
		...(row.website === null ? {} : { website: row.website }),
		...(row.location === null ? {} : { location: row.location }),
	}))

// How many companies a list turns out to hold, given every pair of rows something
// says are one. Rows nothing joins are a company each, and sameness carries: A
// joined to B and B to C is one company, however the three were reached.
const companiesAmong = (
	rowCount: number,
	joined: ReadonlyArray<readonly [number, number]>,
): number => {
	const companies = rowGroups(rowCount)
	for (const [a, b] of joined) companies.join(a, b)
	return companies.count()
}

// The pairs of rows the scan's own fold reads as one company: a shared name once
// the legal form is off the end, a shared site host once the domain spells one of
// them, a branch office and the company it hangs off, and a name beside the same
// name with a note written after it.
const joinedAsTheFoldDoes = (
	rows: ReadonlyArray<Record<string, unknown>>,
	tradeWords: TradeWords,
): ReadonlyArray<readonly [number, number]> => {
	const joined: Array<readonly [number, number]> = []
	// Read over the whole returned list, which is the list the fold read too. Asking
	// row by row would make this stricter than the fold it measures, and call a list
	// clean while it still holds the pairs the fold joins on a site.
	const ownSiteHosts = hostsEstablishedAsOwn(rows, tradeWords)
	const rowOfKey = new Map<string, number>()
	rows.forEach((row, at) => {
		for (const key of discoveryRowIdentityKeys(row, ownSiteHosts)) {
			const seen = rowOfKey.get(key)
			if (seen === undefined) rowOfKey.set(key, at)
			else joined.push([seen, at])
		}
	})
	for (const [branch, parent] of branchOfficeParents(rows))
		joined.push([parent, branch])
	for (const [noted, plain] of bracketedNoteParents(rows, ownSiteHosts))
		joined.push([plain, noted])
	return joined
}

/**
 * Whether two words are one word written two ways — "facility" and "facilities",
 * "energie" and "energies". Two things have to hold, and between them they are what
 * keeps this from reading half a trade's words as each other:
 *
 *  - **What they share at the front outruns what either has left over.** "facility"
 *    and "facilities" share seven letters and trail one and three, so they are the
 *    same word with a different ending. "voltalia" and "voltec" share four and
 *    trail four and two — most of "voltalia" is not in "voltec" at all, and those
 *    are two companies. So is "systovi" beside "systemes", which shares the same
 *    four.
 *  - **And they share enough to be a word.** Two or three letters at the front are
 *    shared by "sud" and "sur", which are different places and different companies.
 *
 * Neither reads what a word means, so neither is a list of words in a language: a
 * word ending differently from the same stem is spelling, and it works the same way
 * in every language written in letters.
 */
const sameWord = (one: string, other: string): boolean => {
	// The same word is the same word however short it is — "2c" opens a name here.
	if (one === other) return true
	let shared = 0
	while (
		shared < one.length &&
		shared < other.length &&
		one[shared] === other[shared]
	)
		shared++
	if (shared < DISTINCTIVE_NAME_LENGTH) return false
	return shared > one.length - shared && shared > other.length - shared
}

/**
 * The pairs of rows whose names read as one company under a looser eye than the
 * fold's: every word of the shorter name is somewhere in the longer one, so the
 * longer says everything the shorter does and possibly more.
 *
 * This is deliberately looser than anything that may be folded on, and the
 * asymmetry is the whole point. "VOLTEC" beside "Voltec Power Technology Solutions"
 * is one company; "Terre Solaire" beside "Terre Solaire Energie" is two; and no
 * rule can separate them, because as rows on a list they are the same shape with
 * the same fields — a name, that name plus words, nothing else to read. Folding on
 * this would take a real company off the list with nothing said. Counting on it
 * costs a reader a look at a pair that turns out to be two companies, which is a
 * price a measurement can pay and a fold cannot.
 *
 * Loose is not the same as careless, and a live French list drew the line. A word
 * is allowed to meet the same word ending differently, which is what reads "PPVS –
 * Facilities Management" and "PPVS – Facility Management France" as one company —
 * but only where other words stand beside it and have to match too. A name that is
 * one word alone puts its whole weight on that one comparison, and allowing it an
 * ending read "Innova", "Innovasun" and "Innovtech" as one company where the run
 * had found three. So a one-word name has to appear in the other name exactly.
 *
 * A name too short to stand for a company is passed over rather than joining every
 * longer name that happens to open the same way.
 *
 * What still moves this number without a repeat behind it: a row whose name is not
 * a company's at all. A live search returned "D'ASCENSEURS" — a fragment left by a
 * name that got cut — and its two words sit inside every lift company on the list,
 * so it read as three repeats. That is the figure working on a bad row rather than
 * failing: a reader who looks finds a row worth striking out either way. It does
 * mean the number answers "how much of this list is worth a second look", not "how
 * many companies came twice", and a run with junk rows in it reads higher.
 */
const joinedByOneNameSayingAnother = (
	rows: ReadonlyArray<Record<string, unknown>>,
): ReadonlyArray<readonly [number, number]> => {
	const names = rows.map(row => {
		const name = row['name']
		if (typeof name !== 'string') return null
		const words = nameCoreTokens(withoutFormDots(name))
		if (words.join('').length < DISTINCTIVE_NAME_LENGTH) return null
		// A word written twice counts once. What is being asked is whether one name
		// says everything the other does, not how many times it says it — and with
		// repeats left in, which of two names is the shorter would come down to how
		// often each said a word, so the same pair would read differently depending
		// on which of the two the model happened to write first.
		return [...new Set(words)]
	})
	const joined: Array<readonly [number, number]> = []
	names.forEach((name, at) => {
		if (name === null) return
		for (let other = at + 1; other < names.length; other++) {
			const beside = names[other]
			if (beside == null) continue
			const [shorter, longer] =
				name.length <= beside.length ? [name, beside] : [beside, name]
			// A name of one word has to appear in the other as that word exactly.
			// Allowing it a different ending reads "Innova", "Innovasun" and
			// "Innovtech" — three companies a live French search returned — as one,
			// because a one-word name puts its whole weight on a single comparison and
			// has nothing beside it to bear out what the ending suggests. A word
			// inside a longer name does: the words around it have to match too, which
			// is what makes "facility" beside "facilities" safe to read as one word.
			const asWritten = shorter.length === 1
			if (
				shorter.every(word =>
					longer.some(had => (asWritten ? word === had : sameWord(word, had))),
				)
			)
				joined.push([at, other])
		}
	})
	return joined
}

/**
 * How many rows repeat a company already on the list — the rows, less the companies
 * they turn out to be — counted two ways, because one figure cannot do it.
 *
 * `duplicated` reuses the keys the pipeline folds on, all four ways of them (see
 * `joinedAsTheFoldDoes`), and sameness carries across them. The list it reads has
 * already been folded that way, so nothing it can see should be left: it answers "is
 * that fold still running and still doing its job", and it moves the moment the
 * answer is no. What it cannot answer is whether those four ways are enough — a
 * repeat of a shape none of them describes reads there as two companies, and it has
 * read a list clean while that list plainly repeated a company.
 *
 * `possiblyDuplicated` is the one that answers that, by being allowed to see what no
 * fold may act on. It joins a pair whose names say the same thing and more, which
 * catches "SNEF" beside "Groupe SNEF" — and also catches "Terre Solaire" beside a
 * genuinely different "Terre Solaire Energie". Both readings are right for what this
 * is: a prompt to go and look, not a claim that two rows are one company.
 *
 * **The gap between the two is the reading.** It is what the fold left standing
 * because nothing structural could tell it from a real pair of companies. That the
 * gap is never negative is by construction rather than by promise: the loose count
 * is taken over the fold's own pairs plus more of them, so a report can subtract one
 * from the other and trust the sign.
 *
 * A row nothing can be read from — a name that is all punctuation, no address —
 * files under no key and so counts as its own company in both. That is the safe
 * direction: neither claims a duplicate it cannot show.
 */
export interface RepeatedRows {
	/**
	 * Read with the keys the pipeline's own fold uses, and with the trades the
	 * golden file names rather than the ones the run split out of its request —
	 * so a row whose host only one of those two vocabularies establishes is
	 * counted differently here from how the run folded it.
	 */
	readonly duplicated: number
	/** Read loosely enough to see what those keys cannot. Never the smaller of the two. */
	readonly possiblyDuplicated: number
}

export const repeatedRows = (
	rows: RunOutcome['companies'],
	tradeWords: TradeWords,
): RepeatedRows => {
	const discoveryRows = asDiscoveryRows(rows)
	// Worked out once and read twice. The loose figure is the strict one's pairs
	// plus more of them, which is what makes it a superset rather than a second
	// opinion that could disagree — and it is also why the joins the fold makes are
	// not worth finding twice over.
	const asTheFoldDoes = joinedAsTheFoldDoes(discoveryRows, tradeWords)
	return {
		duplicated:
			discoveryRows.length -
			companiesAmong(discoveryRows.length, asTheFoldDoes),
		possiblyDuplicated:
			discoveryRows.length -
			companiesAmong(discoveryRows.length, [
				...asTheFoldDoes,
				...joinedByOneNameSayingAnother(discoveryRows),
			]),
	}
}
