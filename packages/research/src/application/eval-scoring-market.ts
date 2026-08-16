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
 * One company's profile is graded by eval-scoring-company.ts instead.
 */

import type { MarketPart, RunOutcome } from './eval-scoring-types'
import { anyTermAppearsIn, termTokens } from './term-match'
import {
	branchOfficeParents,
	discoveryRowIdentityKeys,
} from './prospect-dedupe-guard'

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

/**
 * How many rows are another row's company a second time: the rows, less the
 * companies they turn out to be.
 *
 * Two rows are one company when they share a name with the legal form off the end,
 * share a site host, or one reads as the other's branch office — the same three ways
 * the scan itself folds rows, and sameness carries across all of them.
 *
 * Reusing what the fold uses is what this number is worth and what bounds it. The
 * list it reads has already been folded that way, so nothing it can see should be
 * left: it answers "is that fold still running and still doing its job", and it moves
 * the moment the answer is no. It cannot answer whether those three ways are the
 * right ones — a repeat of a shape none of them describes reads here as two
 * companies, and counting that needs a hand-marked answer to score against, which is
 * a different measurement from this one.
 *
 * A row nothing can be read from — a name that is all punctuation, no address —
 * files under no key and so counts as its own company. That is the safe direction:
 * it never claims a duplicate it cannot show.
 */
export const duplicatedRows = (rows: RunOutcome['companies']): number => {
	// The fields the fold reads a row by, in the shape it reads them: the name, the
	// site, and the place — a branch is told by its name ending on the town it gives.
	const asDiscoveryRows = rows.map(row => ({
		name: row.name,
		...(row.website === null ? {} : { website: row.website }),
		...(row.location === null ? {} : { location: row.location }),
	}))
	const parentOfBranch = branchOfficeParents(asDiscoveryRows)

	// Each company found so far, as the keys its rows filed under. A row meeting one
	// of them is that company again; a row meeting two proves those two were one
	// company all along, so they merge. A branch is filed under the company it hangs
	// off as well as itself, which is how it meets it whichever of the two came first.
	const companies: Array<Set<string>> = []
	for (const [at, row] of asDiscoveryRows.entries()) {
		const parent = parentOfBranch.get(at)
		const parentRow = parent === undefined ? undefined : asDiscoveryRows[parent]
		const keys = [
			...discoveryRowIdentityKeys(row),
			...(parentRow === undefined ? [] : discoveryRowIdentityKeys(parentRow)),
		]
		const matched = companies.filter(company =>
			keys.some(key => company.has(key)),
		)
		const mergeInto = matched[0]
		if (mergeInto === undefined) {
			companies.push(new Set(keys))
			continue
		}
		for (const key of keys) mergeInto.add(key)
		for (const other of matched.slice(1)) {
			for (const key of other) mergeInto.add(key)
			companies.splice(companies.indexOf(other), 1)
		}
	}
	return rows.length - companies.length
}
