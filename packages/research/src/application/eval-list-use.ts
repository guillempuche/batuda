/**
 * What a market list is worth to somebody who has to work through it.
 *
 * The other market figures ask whether the rows are the right kind of company and
 * whether the run stands behind them. None of them asks what a salesperson asks
 * first: can I reach this firm, where exactly is it, how big is it — and did the
 * run find the firms anybody finds with a plain search in ten minutes. A list of
 * sixty correct company names with no web address and "Girona" for a town scores
 * well on all the rest and is close to useless.
 */
import { domainHost, nameCore, withoutFormDots } from './entity-guard'
import type {
	KnownCompany,
	ListUse,
	MarketExpectation,
	RunOutcome,
} from './eval-scoring-types'
import { isSocialPlatformHost } from './social-sites'
import { termTokens } from './term-match'

type Row = RunOutcome['companies'][number]

const foldedName = (name: string): string => nameCore(withoutFormDots(name))

const hostOf = (row: Row): string | undefined =>
	row.website === null ? undefined : domainHost(row.website)

// Two rows may share a host honestly — one firm written twice, a parent and its
// branch — so it takes a third differently-named row to call the host a listing.
// The cost is a firm listed under three names of its own, read as a listing too.
const MIN_FIRMS_ON_A_LISTING = 3

/**
 * The hosts this list uses as a listing: given as the website of several rows
 * that are not the same firm. Read off the list itself, because no table of
 * directories covers every country's, and a page about a firm on somebody
 * else's site is what a run hands back when it never found the firm's own.
 */
const listingHostsOf = (rows: ReadonlyArray<Row>): ReadonlySet<string> => {
	const firmsByHost = new Map<string, Set<string>>()
	for (const row of rows) {
		const host = hostOf(row)
		if (host === undefined) continue
		const firms = firmsByHost.get(host) ?? new Set<string>()
		firms.add(foldedName(row.name))
		firmsByHost.set(host, firms)
	}
	return new Set(
		[...firmsByHost]
			.filter(([, firms]) => firms.size >= MIN_FIRMS_ON_A_LISTING)
			.map(([host]) => host),
	)
}

// A row's own site, or nothing: an address on a social platform or a listing
// reaches a page about the firm, not the firm.
const ownHostOf = (
	row: Row,
	listingHosts: ReadonlySet<string>,
): string | undefined => {
	const host = hostOf(row)
	return host === undefined ||
		isSocialPlatformHost(host) ||
		listingHosts.has(host)
		? undefined
		: host
}

// A word short enough to be the "de" of "Província de Girona" names no place.
// The cost is a town of three letters written with nothing else beside it, which
// reads as the request said again; a street or a postcode next to it still counts.
// So does a town that shares the asked place's name: "Girona" the city, alone,
// cannot be told from "Girona" the province.
const MIN_PLACE_WORD_LETTERS = 4

/**
 * Whether a row's place says more than the request did. `placeWords` are the
 * asked place's own names and anything wider — the province, the region, the
 * country — so a word outside them is a town, a street or a postcode.
 */
const saysMoreThanTheRequest = (
	location: string | null,
	placeWords: ReadonlySet<string>,
): boolean =>
	location !== null &&
	termTokens(location).some(
		token =>
			!placeWords.has(token) &&
			(token.length >= MIN_PLACE_WORD_LETTERS || /\d/.test(token)),
	)

const isTheKnownFirm = (
	row: Row,
	known: KnownCompany,
	listingHosts: ReadonlySet<string>,
): boolean => {
	if (known.host !== null && ownHostOf(row, listingHosts) === known.host)
		return true
	const wanted = foldedName(known.name)
	return wanted !== '' && foldedName(row.name) === wanted
}

export const listUseOf = (
	outcome: RunOutcome,
	market: MarketExpectation,
): ListUse => {
	const rows = outcome.companies
	const placeWords =
		market.placeWords === undefined
			? undefined
			: new Set(market.placeWords.flatMap(word => termTokens(word)))
	const listingHosts = listingHostsOf(rows)
	const known = market.knownCompanies ?? []
	const found = known.filter(firm =>
		rows.some(row => isTheKnownFirm(row, firm, listingHosts)),
	)
	return {
		rowsWithWebsite: rows.filter(
			row => ownHostOf(row, listingHosts) !== undefined,
		).length,
		rowsWithHeadcount: rows.filter(row => row.headcount !== null).length,
		rowsPlacedNarrower:
			placeWords === undefined
				? null
				: rows.filter(row => saysMoreThanTheRequest(row.location, placeWords))
						.length,
		knownFound: found.map(firm => firm.name),
		knownMissed: known
			.filter(firm => !found.includes(firm))
			.map(firm => firm.name),
	}
}
