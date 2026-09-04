/**
 * Takes off a scan's list the rows that rest on a domain one operator built to
 * file itself as several companies.
 *
 * ## What it is
 *
 * A firm registers a domain per trade and per town — `<brand><trade><city>.es` —
 * and files a page under each town it wants to rank for. A search for
 * manufacturers in a town meets one of those pages, and the row that comes back
 * is the operator wearing a trade as its name. The pages say what they are: a
 * *cluster of other firms* the operator passes work to. So there is no company on
 * the row to keep, which is why this drops rather than marks — the same reading
 * the organisation-kind check takes of a trade body, and the opposite of the
 * place check next door, which only ever marks because a company in the wrong
 * place is still a company.
 *
 * ## A host gives itself away, and only a host
 *
 * Three things have to hold on one address, and each is there to keep an
 * ordinary business out:
 *
 *  - **its own name carries a place the request asked about** — the domain says
 *    Barcelona;
 *  - **it files that page under a place it does NOT carry** — the page says
 *    Cerdanyola. A firm's own site does not name one town and file its pages
 *    under another. The page's place is read as WHOLE WORDS of the path, the way
 *    `directory-sites.ts` reads a name filed in an address, so "Barcelonès" is
 *    not mistaken for "Barcelona";
 *  - **and the domain spells a company on the list in words that are not the
 *    place it already gave up.** This is the one that keeps ordinary firms out,
 *    and it has to discount the place: a domain naming a town spells "Serralleria
 *    del Vallès" through `valles` alone, and read that way a directory took two
 *    real companies off a list. What counts is two DISTINCTIVE words —
 *    `entity-guard.ts`'s reading, which already drops legal forms, words for a
 *    kind of company, and anything too short to identify anybody — minus every
 *    word of a place the request named.
 *
 * ## Only the rows that rest on it
 *
 * A row goes when one of its own addresses is such a host. Nothing spreads by
 * name.
 *
 * Spreading over rows whose names begin alike was tried and withdrawn: it read
 * the first word of a name as a brand, and Spanish and Catalan firms lead with
 * their trade by default — Talleres, Transports, Mecanitzats, Estampacions —
 * which are the run's own request words, and therefore what a scan returns. One
 * caught host then took every unrelated firm on the list that happened to start
 * the same way. It also folded a legal form written first ("SARL Dupont", "SARL
 * Martin") into one operator, and chained one-letter leads together without limit.
 *
 * What that costs is the rows of an operator that cite nothing of its own — a
 * bare host with no page, or a finance profile. Those survive. A miss is a miss;
 * the alternative deleted companies somebody paid to find.
 *
 * ## What it will not catch, and what it is worth
 *
 * The reading needs two places to tell apart, and a run states its area as ONE
 * string. "Ripollet (Barcelona)" is a pair and works; a request naming several
 * towns is answered with the widest place containing them all, which is one
 * place, and then nothing is dropped. A domain that carries BOTH places is left
 * alone too: a firm naming the town it files under is saying where it is.
 *
 * Over twenty-two production scans — three hundred and sixty-four rows, fourteen
 * of them one operator's — handed every town its request named it takes nine, and
 * handed the single area a run actually states, six. No real company goes in
 * either reading. Those rows are what the chain finally stored, which is why this
 * link runs after the fold rather than before it: measured on one list and run on
 * a longer one, the number would be about something else.
 *
 * Nothing here reads a page. The operator's pages share a phone number and a
 * misspelling across every domain, which would settle it outright, and is the
 * sharper instrument for when this one is measured short.
 */

import { filingWords, namesTheCompany } from './directory-sites'
import { collapse, distinctiveWords } from './entity-guard'
import { citedSourceIds, isPlainObject, readTextValue } from './guard-shapes'
import { hostOf, isBareWebAddress } from './source-key'

/**
 * How short a place name may be and still be read against a domain.
 *
 * Three letters, so "Olot" and "Rubí" are read. The company-name floor next door
 * is four and answers a different question — whether a word identifies one firm
 * among many — where this only asks whether a domain carries a town, and a town
 * of four letters is as much a town as any other. Borrowing that constant here
 * silently switched the whole check off for every four-letter municipality.
 */
const SHORTEST_PLACE_READ = 3

/**
 * The places a request's area names, taken apart.
 *
 * A run states its area as one string in the request's own words — "Ripollet
 * (Barcelona)" — and this check needs the parts, because what gives an operator
 * away is a domain naming ONE of them and filing a page under ANOTHER. A town and
 * the province it sits in are exactly that pair, and the brackets are how a
 * request writes it. A request joining two towns with a word — "Barberà i Badia"
 * — is taken apart the same way, since left whole neither town can be matched.
 */
export const placesNamed = (area: string): ReadonlyArray<string> => [
	...new Set(
		area
			.split(/[(),/]|\s+[-–—]\s+|\s+(?:i|y|e|and|und|et)\s+/i)
			.map(part => part.trim())
			.filter(part => part !== ''),
	),
]

/** One row taken off the list, for the log: who it claimed to be and where from. */
export interface DroppedNetworkRow {
	readonly name: string
	/** The host that gave the operator away, so a reader can go and look. */
	readonly host: string
}

export interface NetworkGuardResult {
	readonly findings: unknown
	readonly dropped: ReadonlyArray<DroppedNetworkRow>
	/**
	 * The domains read as one operator's, listed once rather than repeated on
	 * every row they took off. This is the evidence: a person doubting a drop
	 * opens these, not the row.
	 */
	readonly hosts: ReadonlyArray<string>
}

/** A place as a domain would spell it, and as a path's words would. */
interface KnownPlace {
	readonly label: string
	readonly words: string
}

/**
 * Every address a row rests on: its own website and the pages it cites.
 *
 * Screened the strict way, the way `directory-sites.ts` screens what it watches:
 * a value carrying prose after the address parses with that prose escaped into
 * the path, where its words read as more place names, and an internal source id
 * parses as a host of its own.
 */
const addressesOf = (row: Record<string, unknown>): ReadonlyArray<string> => {
	const website = readTextValue(row['website'])
	return [
		...new Set(
			[...(website === null ? [] : [website]), ...citedSourceIds(row)].filter(
				isBareWebAddress,
			),
		),
	]
}

/**
 * Whether a domain's own label spells this company in words that are not the
 * place the label already carries.
 *
 * Two of them, not one: a single word matches far too easily. Both come from the
 * reading that already knows a legal form and a word for a kind of company
 * identify nobody.
 */
const labelSpellsACompany = (
	label: string,
	name: string,
	placeWords: ReadonlySet<string>,
): boolean =>
	distinctiveWords(name).filter(
		word => !placeWords.has(word) && label.includes(word),
	).length >= 2

export const dropNetworkRows = (
	findings: unknown,
	listField: string | undefined,
	places: ReadonlyArray<string>,
): NetworkGuardResult => {
	const nothing = { findings, dropped: [], hosts: [] }
	if (listField === undefined) return nothing
	if (!isPlainObject(findings)) return nothing
	const list = findings[listField]
	if (!Array.isArray(list)) return nothing

	const known: ReadonlyArray<KnownPlace> = places
		.map(place => ({ label: collapse(place), words: collapse(place) }))
		.filter(place => place.label.length >= SHORTEST_PLACE_READ)
	if (known.length < 2) return nothing

	// Every word any of those places is written with, so the reading below can
	// discount a company "spelled" by nothing but the town in the domain.
	const placeWords = new Set(places.flatMap(place => distinctiveWords(place)))

	const rows = list.filter(isPlainObject)

	// Which of the run's companies rest on each host, so a domain can be asked
	// whether it spells any of them.
	const restingOn = new Map<string, Array<string>>()
	for (const row of rows) {
		const name = readTextValue(row['name'])
		if (name === null) continue
		for (const address of addressesOf(row)) {
			const host = hostOf(address)
			if (host === null) continue
			const seen = restingOn.get(host)
			if (seen === undefined) restingOn.set(host, [name])
			else seen.push(name)
		}
	}

	const caught = new Set<string>()
	for (const row of rows) {
		for (const address of addressesOf(row)) {
			const host = hostOf(address)
			if (host === null || caught.has(host)) continue
			const label = collapse(host.split('.')[0] ?? '')
			// Every place the domain carries, not merely the first one found: which
			// place a host names must not depend on the order the request wrote them.
			const carried = new Set(
				known.filter(place => label.includes(place.label)).map(p => p.words),
			)
			if (carried.size === 0) continue
			const segments = filingWords(address)
			const filedUnder = known.find(
				place =>
					!carried.has(place.words) &&
					segments.some(segment => namesTheCompany(segment, place.words)),
			)
			if (filedUnder === undefined) continue
			const residents = restingOn.get(host) ?? []
			if (!residents.some(name => labelSpellsACompany(label, name, placeWords)))
				continue
			caught.add(host)
		}
	}
	if (caught.size === 0) return nothing

	const dropped: Array<DroppedNetworkRow> = []
	const kept: Array<unknown> = []
	for (const row of list) {
		const host = isPlainObject(row)
			? (addressesOf(row)
					.map(hostOf)
					.find(candidate => candidate !== null && caught.has(candidate)) ??
				null)
			: null
		if (host === null || !isPlainObject(row)) {
			kept.push(row)
			continue
		}
		dropped.push({ name: readTextValue(row['name']) ?? '', host })
	}

	return {
		findings:
			dropped.length === 0 ? findings : { ...findings, [listField]: kept },
		dropped,
		hosts: [...caught],
	}
}
