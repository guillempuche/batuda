/**
 * Which websites this run watched behave like a business directory.
 *
 * A directory is a site that exists to list other companies — a trade body's
 * member pages, a chamber's register, a yellow-pages site. No fixed list of hosts
 * can name them: every country has its own, so the directories a Spanish search
 * meets are not the ones an American list holds. This decides it from behaviour
 * instead, inside the run: watch which hosts file MORE THAN ONE of this search's
 * own companies at an address carrying that company's name. A host doing that for
 * two of them is a listing.
 *
 * A company's OWN site is stepped over, one company at a time. A group's own
 * domain carries a page for the group and a page for each part of it, so a list
 * holding two parts of one group would otherwise watch that domain file two
 * companies and brand it a listing — which costs the group its website, and then
 * its standing to vouch for itself. Whose site a host is comes from
 * `own-site.ts`, the single answer the rest of the run uses, so the watch cannot
 * reach a different one.
 *
 * Asking one company at a time is what keeps a franchise caught. A franchise's
 * domain is established as the franchise's own, so its pages about itself are
 * stepped over — while its pages filing affiliates it does NOT name are weighed
 * as usual, and two of those still make it a listing. Asking once for the whole
 * list instead would step over every address on the host the moment any one
 * company owned the domain, and a franchise on its own list would clear itself.
 *
 * The other side of that is a firm's own site with a page for each of its
 * partners, which reads as a listing. Those pages really are about companies
 * whose site it is not, so the reading is right — and it is paid for by the firm
 * itself, which loses that host as its website and as the thing that vouches for
 * it. That is the known price of the rule below, and the reason
 * `COMPANIES_THAT_MAKE_A_LISTING` is not lowered.
 *
 * The price is NOT bought off by telling `website-guard.ts` to keep a website
 * whenever `own-site.ts` says the company owns the host. That was tried and it
 * fails wide open: ownership there is granted by any distinctive word of a name,
 * so "Instalaciones Eléctricas Girona" owns girona.cat and every company named
 * after its town or its trade would keep a directory's page as its website — in
 * exactly the markets this is for. Ownership is a positive claim safe to COUNT
 * and to clear a company with; it is not safe to overrule a blank with.
 *
 * What it watches is every address the run met — each result its searches returned,
 * each page it fetched, and the addresses those pages link to. That last one is not
 * an extra: a search hands back a listing's category page, which names a trade and
 * a place and no company at all, and the addresses that name companies are the ones
 * it links to. Reading them costs nothing, since the text is already fetched.
 *
 * This only ever produces the NEGATIVE verdict. A host seen for a single company
 * is `unknown`, never "not a directory": nothing here can establish that a site
 * ISN'T a listing, only that it is. So a thin sample can withhold a confirmation
 * and can never manufacture one, which is the whole point — a caller asking "is
 * at least one of these sources not a directory?" must not be able to answer yes
 * out of silence. That is why the verdict has two values and no third one meaning
 * "cleared": there is no value here to answer yes with.
 *
 * The key is the RAW host as met, never folded to a registrable domain.
 * `empresite.eleconomista.es` is a directory and `eleconomista.es` is a real
 * newspaper; folding the first into the second would label the newspaper, and
 * newspapers are exactly the sites that have to survive as the non-directory
 * source. The cost is a directory that gives each company its own subdomain,
 * which is then several sites seen once each — a miss, in the safe direction.
 *
 * A name is looked for whole and on whole words, so a directory filing companies
 * under a one-word trading name ("/puig") is missed. Catching that means deciding
 * which fragment of a name a site may be filed under, and a fragment matches
 * addresses that have nothing to do with the company — which is the expensive
 * mistake, not the cheap one. Saying "directory" is not a withholding: it takes a
 * company's website away.
 *
 * A host is judged on every address met on it together, so a local paper that ran
 * two pieces, each naming a different one of the run's companies in its address,
 * reads like a listing. That is the sharpest edge left, and reading a page's links
 * makes it sharper rather than blunter: one fetched section page hands over every
 * article on it at once, so two such pieces is ordinary rather than unlucky. What
 * it costs is the paper's standing as a source that is not a directory, never a
 * company's own site — no company's website is a newspaper — and it stays only
 * until there is a measurement to set something finer against.
 *
 * Counting how many of a host's addresses sit under one path is NOT the way to
 * sharpen it, however much it looks like the same idea. That was measured correct
 * on eleven sites across four countries and wrong on the twelfth: on a regional
 * newspaper the busiest path holds 0.285 of the addresses when 200 are looked at
 * and 0.696 when 700 are, because a date archive grows without limit while a
 * section list does not. The number tracks how hard the site was looked at rather
 * than what it is, and at the larger sample a newspaper scores like a business
 * directory. It also needs a crawl of each site, which the runs that most need
 * this answer cannot afford.
 */

import {
	DISTINCTIVE_NAME_LENGTH,
	foldTokens,
	spellingsWithoutForms,
} from './entity-guard'
import { isPlainObject } from './guard-shapes'
import { ownSiteHostVerdict } from './own-site'
import { hostOf, isBareWebAddress, pathOf } from './source-key'
import type { TradeWords } from './trade-words'

/** Hosts this run watched file several of its own companies. */
export type DirectorySites = ReadonlySet<string>

/**
 * What is known about a site. `unknown` is not "cleared". Spelled as a value
 * rather than left as the absence of one, so a caller has to name it before
 * acting on it.
 */
export type SiteVerdict = 'directory' | 'unknown'

// How many of the run's own companies a host must file before it is a listing, and
// how many separate addresses those filings must sit at. Both are two: one page
// naming two companies is a piece about a deal between them, not a site that files
// each of them somewhere of its own.
const COMPANIES_THAT_MAKE_A_LISTING = 2

// One of the run's companies: the name an address would write it under, and the
// name it is counted as. Those two are separate because a Catalan name can be
// written out two ways — an address may spell either, while the company is still
// one company and must be counted once.
interface ListedCompany {
	readonly countedAs: string
	readonly writtenAs: ReadonlyArray<string>
	// Kept unfolded beside the spellings because the own-site reading below takes a
	// name and folds it its own way. Handing it a spelling folded here would be a
	// second answer to a question that already has one.
	readonly rowNames: ReadonlyArray<string>
}

// Every way an address would write this company's name, folded so case, accents
// and punctuation stop mattering. Empty when nothing distinctive is left to look
// for.
//
// Four letters, where `own-site.ts` reads a domain from three. The two floors
// answer different questions and the gap is deliberate: a three-letter run found
// in a path turns up by coincidence — a language code, a section name — and would
// file the wrong company, while a domain that IS three letters is the whole of
// what a large carrier registered (dsv.com, xpo.com).
//
// What it costs is a listing that files companies named in three letters: they
// have no filable spelling, so a site filing "DSV" and "XPO" is never watched
// filing anybody and goes unnoticed. That is a miss and not a deleted website,
// which is the direction to be wrong in — and a three-letter company is no worse
// off on its own domain than a longer-named one, since its own pages cannot be
// filed against it either.
//
// Lowering it to three was measured rather than argued, and is not worth it. It
// does catch that missed listing. It also files any row whose name folds to an
// ordinary three-letter part of an address — a language code, a region, a
// section — so a firm's own site with pages at "/sud" and "/est", beside two
// rows named for those regions, is branded a listing and loses real websites.
// Over three live market runs the lower floor changed nothing at all: the same
// hosts branded, no website kept or lost. A broad new way to be wrong, bought
// for a benefit that did not appear.
const filedAs = (name: string): ReadonlyArray<string> =>
	spellingsWithoutForms(name).filter(
		spelling => spelling.length >= DISTINCTIVE_NAME_LENGTH,
	)

// Whether a shorter name already seen is this same company: any way of writing
// this one starts with any way of writing that one. Compared across spellings and
// not between the two names as written, because the pair this exists to catch is
// exactly a firm whose two rows spell one word differently.
const isTheSameCompanyAgain = (
	company: { readonly writtenAs: ReadonlyArray<string> },
	earlier: { readonly writtenAs: ReadonlyArray<string> },
): boolean =>
	company.writtenAs.some(written =>
		earlier.writtenAs.some(before => written.startsWith(before)),
	)

// One company per name, rather than one per spelling. A name that another name
// starts with is the same company written at more length — "Grupo Ferré" and
// "Grupo Ferré Instalacions" — and counting both would let a firm's own site,
// which names itself in two ways, reach the two it takes to be a listing. The fold
// that settles spellings for good runs after this check, so it cannot be leant on
// here.
const distinctCompanies = (
	companies: ReadonlyArray<ListedCompany>,
): ReadonlyArray<ListedCompany> => {
	const byName = new Map<string, ListedCompany>()
	for (const company of companies) {
		const seen = byName.get(company.countedAs)
		// Every spelling either row was written with, rather than whichever row came
		// first: two rows of one company can spell it differently, and a listing
		// filing it under the spelling the other row used still files this company.
		byName.set(
			company.countedAs,
			seen === undefined
				? company
				: {
						countedAs: company.countedAs,
						writtenAs: [...new Set([...seen.writtenAs, ...company.writtenAs])],
						rowNames: [...new Set([...seen.rowNames, ...company.rowNames])],
					},
		)
	}
	// Spelled out with the row names writable, rather than leaning on an
	// intersection to strip the `readonly` off `ListedCompany`, because they really
	// are rewritten below: a company only learns the rest of its names as the
	// longer rows that fold into it arrive.
	interface Absorbing {
		readonly countedAs: string
		readonly writtenAs: ReadonlyArray<string>
		rowNames: ReadonlyArray<string>
	}
	const ordered = [...byName.values()].sort(
		(a, b) => a.countedAs.length - b.countedAs.length,
	)
	const kept: Array<Absorbing> = []
	// Which surviving company each row ends up under, the dropped rows included.
	// A row repeats an EARLIER row whether or not that earlier one survived, and
	// the difference matters: a name can be written several ways, so the chain
	// from one row to the next may run through a row that was itself dropped.
	// "Moll", "Møller Transport" — which reads both "moller…" and "moeller…" —
	// and "Moeller Transport Nord" are one company, though the last spells
	// nothing the first does. Comparing only against survivors breaks that chain
	// and counts one company as two, which is the whole thing this prevents.
	const survivorOf: Array<Absorbing> = []
	for (const [at, company] of ordered.entries()) {
		const repeatsAt = ordered.findIndex(
			(seen, before) => before < at && isTheSameCompanyAgain(company, seen),
		)
		const survivor = repeatsAt === -1 ? undefined : survivorOf[repeatsAt]
		if (survivor === undefined) {
			const entry = { ...company }
			kept.push(entry)
			survivorOf[at] = entry
			continue
		}
		// The longer row is this company written at more length. Its row is dropped
		// and its NAME is not: a firm whose two rows read "Grup Blau" and "Grup Blau
		// Instal·lacions" may have registered the longer one, and only that spelling
		// recognises its own domain.
		//
		// The spellings a host files it under are deliberately not merged the same
		// way. A longer name reaches more addresses, and every extra address a host
		// is read as filing takes some company's website away, while an extra name a
		// company may own only ever withholds a branding — so each list is generous
		// in the direction that costs nothing.
		survivorOf[at] = survivor
		survivor.rowNames = [
			...new Set([...survivor.rowNames, ...company.rowNames]),
		]
	}
	return kept
}

// The names of this scan's own companies.
const listedCompanyNames = (
	findings: unknown,
	listField: string,
): ReadonlyArray<string> => {
	const names: Array<string> = []
	const visit = (value: unknown, key?: string): void => {
		if (Array.isArray(value)) {
			if (key === listField) {
				for (const row of value) {
					if (isPlainObject(row) && typeof row['name'] === 'string') {
						names.push(row['name'])
					}
				}
				return
			}
			for (const item of value) visit(item)
			return
		}
		if (!isPlainObject(value)) return
		for (const [childKey, child] of Object.entries(value)) {
			visit(child, childKey)
		}
	}
	visit(findings)
	return names
}

// How many of one page's DIFFERENT links are read. A sitemap or an A-to-Z index
// can carry thousands, and past the first few hundred they say nothing the earlier
// ones did not — while every one of them is weighed against every company on the
// list. Counted after repeats are folded away, because a listing page puts its
// filters and its navigation above its companies: cap the raw matches instead and
// a few hundred copies of one menu link eat the whole budget before the first
// company is reached.
const MAX_LINKS_PER_PAGE = 300

// Addresses written as ordinary links, "https://…", picked out of a fetched page's
// text. The characters a link cannot hold end the match; what a link CAN hold but
// prose also puts after one is shaved off below. Square brackets end it too, even
// though an address may technically hold them: markdown writes one link straight
// after another with nothing between them, and without that the two run together
// into a single address that is neither. The scheme is read whichever case the
// page wrote it in.
const LINK_IN_PAGE = /https?:\/\/[^\s<>"'`[\]]+/gi
const TRAILING_PUNCTUATION = /[.,;:}]+$/

// Markdown writes a link inside brackets, so a closing bracket at the end is the
// markdown's and not the address's — unless the address opened one itself, which
// is how an encyclopaedia tells two things of the same name apart
// ("/wiki/Acme_(empresa)"). Shave only the unmatched ones, so the address that
// keeps its bracket is the one that had it.
const withoutWrappingBrackets = (link: string): string => {
	let end = link.length
	let depth = 0
	for (let at = link.length - 1; at >= 0 && link[at] === ')'; at--) depth++
	for (const character of link) if (character === '(') depth--
	while (depth > 0 && end > 0 && link[end - 1] === ')') {
		end--
		depth--
	}
	return link.slice(0, end)
}

/**
 * The addresses a page the run fetched links to.
 *
 * A listing's own index page is where its per-company addresses are: the search
 * that found the listing returns its category page — "…/INSTALACIONES-ELECTRICAS/
 * localidad/GIRONA-GERONA/", which names a trade and a province and no company —
 * and the addresses that name companies are one level in, linked from it. Reading
 * them out of text the run already fetched puts them in front of the watch below
 * without paying to fetch a single one.
 *
 * Only whole addresses are read. A page that writes its links relative to itself
 * ("/EMPRESA.html") is missed rather than guessed at, since resolving them means
 * deciding what they are relative to and getting that wrong invents addresses.
 *
 * A listing that sends every outbound link through a counter of its own
 * ("…/out.php?u=…") is read as the one address it is, on the listing's host. The
 * company it points at is inside the question mark, which nothing here reads, so
 * such a listing files nobody and goes unnoticed — a miss, in the safe direction.
 */
export const linkedAddresses = (pageText: string): ReadonlyArray<string> =>
	[
		...new Set(
			(pageText.match(LINK_IN_PAGE) ?? []).map(link =>
				withoutWrappingBrackets(link).replace(TRAILING_PUNCTUATION, ''),
			),
		),
	].slice(0, MAX_LINKS_PER_PAGE)

// The words of each part of an address after the host — [["empresa"], ["acme",
// "s", "l"]] from "directorio.es/empresa/ACME-S.L.". A path arrives with its
// accents written as escapes, which is how a Spanish or Catalan listing spells
// most of its names, so it is put back into letters before anything is read off
// it; a path that was never valid escaping is read as it stands rather than
// dropped.
export const filingWords = (
	address: string,
): ReadonlyArray<ReadonlyArray<string>> => {
	const path = pathOf(address)
	if (path === null) return []
	const spelled = (() => {
		try {
			return decodeURIComponent(path)
		} catch {
			return path
		}
	})()
	return spelled
		.split('/')
		.map(foldTokens)
		.filter(words => words.length > 0)
}

/**
 * Whether one run of whole words spells the name exactly.
 *
 * Asking only whether the name appears somewhere inside would file "Roca" under
 * "/barroca-inversiones" and "Mont" under "/montcada-i-reixac", and two such
 * names in one list are enough to call a newspaper a listing.
 *
 * Shared with whoever else has to decide that a piece of text names a company.
 * Both callers are adding something on the strength of it — a filing here, a
 * source next door — so both need the reading that errs towards saying no.
 */
export const namesTheCompany = (
	segment: ReadonlyArray<string>,
	core: string,
): boolean => {
	for (let from = 0; from < segment.length; from++) {
		let run = ''
		for (let to = from; to < segment.length; to++) {
			run += segment[to]
			if (run === core) return true
			if (run.length >= core.length) break
		}
	}
	return false
}

export interface DirectoryObservation {
	/** The hosts that filed several of this run's companies. */
	readonly sites: DirectorySites
	/**
	 * How many of the addresses handed in were real, readable web addresses —
	 * counted whether or not there were companies to weigh them against, because
	 * what it exists to answer is whether the run gathered anything at all.
	 */
	readonly addressesRead: number
}

/**
 * Watch the addresses this run gathered and say which of their hosts are listings.
 *
 * `addresses` are the pages the run actually met — its searches' results and the
 * pages it fetched. They are screened as web addresses first: an internal source
 * id like `src_9f2a1b` would otherwise yield the "host" `src_9f2a1b` and count as
 * a website. The screen is the strict one, `isBareWebAddress`: saying yes here
 * adds a filing that can end with a company's site taken away, so the generous
 * reading — which lets a value with prose after the address through, its words
 * escaped into the path where they read as more names — is the costly direction.
 *
 * `listField` is the key holding this scan's companies — `prospects` or
 * `competitors`. A run about one named company has no list to compare and so
 * observes nothing: one company can never reach two.
 */
export const observeDirectorySites = (args: {
	readonly findings: unknown
	readonly listField: string | undefined
	readonly addresses: ReadonlyArray<string>
	readonly tradeWords: TradeWords
}): DirectoryObservation => {
	const { findings, listField, addresses, tradeWords } = args
	const readable = addresses.filter(isBareWebAddress)
	const addressesRead = readable.length
	if (listField === undefined) return { sites: new Set(), addressesRead }

	const names = listedCompanyNames(findings, listField)
	// The name as written leads its spellings, so a company is counted under that
	// one however an address happens to spell it.
	const companies = distinctCompanies(
		names.flatMap(name => {
			const writtenAs = filedAs(name)
			const countedAs = writtenAs[0]
			return countedAs === undefined
				? []
				: [{ countedAs, writtenAs, rowNames: [name] }]
		}),
	)
	if (companies.length < COMPANIES_THAT_MAKE_A_LISTING) {
		return { sites: new Set(), addressesRead }
	}

	// Which of the run's companies each host files, and where. The addresses are
	// held rather than counted, because one page naming two of them is a piece
	// about both — it takes a separate address per company to be a listing.
	const filedByHost = new Map<string, Map<string, Set<string>>>()
	// A host that is established as a company's own site files nothing for THAT
	// company: a firm's own site names itself, and a group's own site carries a
	// page for each part of the group. Answered once per company and host, since
	// hundreds of addresses read off one index page all share theirs.
	const ownSiteAnswers = new Map<string, boolean>()
	const isOwnSiteOf = (company: ListedCompany, host: string): boolean => {
		// Joined with a line break, which neither a folded name nor a host can hold,
		// so no two pairs can fall on one key.
		const key = `${company.countedAs}\n${host}`
		const known = ownSiteAnswers.get(key)
		if (known !== undefined) return known
		const own = company.rowNames.some(
			name => ownSiteHostVerdict({ name, host, tradeWords }) === 'established',
		)
		ownSiteAnswers.set(key, own)
		return own
	}
	for (const address of readable) {
		// Non-null: the screen above already parsed every address that got here.
		const host = hostOf(address) ?? ''
		// Read once for the address and only when some company still needs it: a
		// group's own index page hands over hundreds of addresses that every company
		// on the list steps over, and putting each of them back into letters before
		// asking would be the whole page's work for nothing.
		if (companies.every(company => isOwnSiteOf(company, host))) continue
		const segments = filingWords(address)
		for (const company of companies) {
			if (isOwnSiteOf(company, host)) continue
			if (
				segments.some(segment =>
					company.writtenAs.some(spelling =>
						namesTheCompany(segment, spelling),
					),
				)
			) {
				const filed = filedByHost.get(host) ?? new Map<string, Set<string>>()
				const at = filed.get(company.countedAs) ?? new Set<string>()
				at.add(address)
				filed.set(company.countedAs, at)
				filedByHost.set(host, filed)
			}
		}
	}

	const sites = new Set<string>()
	for (const [host, filed] of filedByHost) {
		if (filed.size < COMPANIES_THAT_MAKE_A_LISTING) continue
		const addressesFiledAt = new Set([...filed.values()].flatMap(at => [...at]))
		if (addressesFiledAt.size >= COMPANIES_THAT_MAKE_A_LISTING) sites.add(host)
	}
	return { sites, addressesRead }
}

/**
 * What is known about a host. Anything this run did not watch file several of its
 * companies is `unknown`, which is not a clearance.
 */
export const siteVerdict = (
	host: string,
	sites: DirectorySites,
): SiteVerdict => (sites.has(host) ? 'directory' : 'unknown')
