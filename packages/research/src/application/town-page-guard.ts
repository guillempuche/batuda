/**
 * Refuses a place that was read off a page the firm wrote ABOUT that town.
 *
 * ## What it is
 *
 * An ordinary business writes one landing page per town it will travel to —
 * `stemp.es/mecanizados-castellar-del-valles/`, one of a dozen like it. A scan
 * meeting that page reads the town as where the firm is. It is not: the page says
 * where the firm will GO. Twenty-two production scans carried thirteen such rows,
 * and one firm came back placed in three different towns by three of them.
 *
 * The firm is real and belongs on the list, so nothing here drops a row. What is
 * wrong is one field, and one field is what comes off — the same treatment, in the
 * same pass, as a location that names a service area rather than a place.
 *
 * ## Why the place check next door cannot answer this
 *
 * That check compares a row's place to the area the request named, and the
 * splitter is told to answer a request naming several towns with the widest place
 * containing them all. Eight of those thirteen rows came from requests naming two
 * to five towns, so the area is the PROVINCE — and a firm in Vacarisses really is
 * inside Barcelona. Asked that question the check answers "inside" and is right.
 *
 * This asks a different question, and one that does not depend on what was asked:
 * does the page this place was read on establish it? So it runs whether or not the
 * run named an area.
 *
 * ## The page names itself
 *
 * A location arrives paired with the page it was read on, and in eleven of the
 * thirteen that page IS the landing page. So nothing has to be fetched or guessed:
 * the reading is whether the page a place cites is filed under that same place.
 *
 * Three things have to hold, and each keeps an honest row out:
 *
 *  - **the page is on the firm's OWN site.** A directory filing a company under
 *    its town is doing its job — `einforma.com/viladecavalls`,
 *    `informa.es/localidad-sabadell-barcelona` — and reading a place off one of
 *    those is good evidence. Without this screen the rule fires on sixteen
 *    ordinary rows out of three hundred and thirty-seven; with it, on none.
 *  - **the page says more than the town.** A path that is only the place is an
 *    index of a town, not a page written about one.
 *  - **the town is not part of the company's own name.** "SA RUBI INDUSTRIAL"
 *    filed at `/sa-rubi-industrial` is spelling itself, not filing under Rubí, and
 *    it is the one false refusal the first two screens leave behind.
 *
 * ## What it will not reach
 *
 * A row whose website is missing has nothing to establish its own site with, and
 * loosening that to "the one host it rests on" trades two more catches for
 * twenty-eight ordinary rows wearing a doubt they did not earn. A location written
 * bare, without the page it was read on, cannot be graded at all — findings stored
 * before that field was paired keep the shape they were written in, and nothing
 * migrates them.
 *
 * Measured over those twenty-two scans: eight of the thirteen refused, no ordinary
 * row touched, no company deleted.
 */

import { filingWords, namesTheCompany } from './directory-sites'
import { collapse, foldTokens } from './entity-guard'
import { isCitedField, readTextValue } from './guard-shapes'
import { hostOf, isBareWebAddress } from './source-key'

/**
 * How short a place may be and still be read against a path.
 *
 * Three letters, so "Olot" and "Rubí" are read. The same floor the operator check
 * next door uses, and for the same reason: this asks only whether a path carries a
 * town, and a town of four letters is as much a town as any other.
 */
const SHORTEST_PLACE_READ = 3

/** Why one place was refused, for the log: what was read, and off what. */
export interface TownPageReading {
	/** The firm's own site, which is where the page was. */
	readonly host: string
	/** The place the row stated, as the path spells it. */
	readonly place: string
	/** The path segment that filed the page under it, so a reader can go and look. */
	readonly filedAs: string
}

/**
 * The place a location CLAIMS, as a path would spell it.
 *
 * Taken apart on commas and brackets because a location is written "Castellar del
 * Vallès, Barcelona, España" and the page is filed under one of those parts, never
 * under the whole string — and then only the FIRST is read, because that is the
 * place the row is claiming and the rest are the province and country around it.
 *
 * Reading the wider ones too was tried and is a trap. A firm in Rubí writes
 * "Rubí, Barcelona", and its own site names its province in ordinary paths —
 * `/serveis-barcelona`, `/delegacions/barcelona`, a news post about Barcelona.
 * Matching on `barcelona` there refuses the whole location and takes the correct
 * town away with it. A page filed under the province says nothing about which of
 * its towns the firm sits in. Over three hundred and sixty-four stored rows the
 * check fires eight times and every one matches this first place, so reading only
 * it costs no catch at all.
 */
const placeClaimed = (stated: string): string | undefined =>
	stated
		.split(/[,()]/)
		.map(part => collapse(part))
		.find(part => part.length >= SHORTEST_PLACE_READ)

/**
 * Whether this row's place was read off a page the firm filed under that place.
 *
 * Null whenever it cannot be established — a bare location, no website, a page
 * somewhere else — because saying nothing is what leaves the row alone.
 */
export const placeReadOffATownPage = (
	row: Record<string, unknown>,
): TownPageReading | null => {
	const location = row['location']
	// A location that does not name the page it was read on cannot be graded, and
	// a value that is not text is not a place.
	if (!isCitedField(location)) return null
	const stated = typeof location.value === 'string' ? location.value : ''
	if (stated.trim() === '') return null
	const page = location.source_id.trim()
	if (!isBareWebAddress(page)) return null
	const host = hostOf(page)
	if (host === null) return null

	// Only the firm's own site. A directory filing a company under its town is
	// stating where it is, which is the opposite of what this refuses.
	const website = readTextValue(row['website'])
	if (website === null || hostOf(website) !== host) return null

	// The company's name read exactly the way the path above is read — its words
	// as written. Deliberately NOT the reading that asks which words identify a
	// firm among many: that one drops a connector, and "Castellar del Vallès"
	// without its "del" can never spell the town again, which is most towns here.
	const ownWords = foldTokens(readTextValue(row['name']) ?? '')

	const place = placeClaimed(stated)
	if (place === undefined) return null
	// The town is part of the company's own name, so a path carrying it is
	// spelling the name rather than filing the page under a town.
	if (namesTheCompany(ownWords, place)) return null

	for (const segment of filingWords(page)) {
		if (!namesTheCompany(segment, place)) continue
		// A path that is only the place is an index of a town, not a page about one.
		if (segment.join('') === place) continue
		return { host, place, filedAs: segment.join('-') }
	}
	return null
}
