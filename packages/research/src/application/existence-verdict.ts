/**
 * Whether a company a search returned is established as one that exists.
 *
 * Nothing else asks. A name the model produced and a name that exists are
 * indistinguishable to every other check, so a sixty-row list arrives as sixty
 * findings with no statement about which of them anybody can stand behind.
 *
 * The rule is two conditions, and both have to hold:
 *
 *  1. TWO INDEPENDENT WEBSITES name the company. Two pages of one site are one
 *     source, so the count runs on the registered domain rather than the host as
 *     met: `blog.acme.es` and `acme.es` are one website, and so are
 *     `empresite.eleconomista.es` and `eleconomista.es`.
 *  2. AT LEAST ONE of them is established as the company's own site and is not a
 *     listing.
 *
 * ## Why the second condition is stricter than it reads
 *
 * "At least one source is not a directory" sounds like it should be enough, and
 * would admit a trade paper. It is not the rule, and the reason is the shape of
 * the verdicts this package owns rather than a preference. `siteVerdict`
 * (`directory-sites.ts`) answers `directory` or `unknown` and has no third value
 * meaning cleared — deliberately, so that a caller cannot answer "is one of
 * these not a listing?" out of silence. A newspaper is therefore `unknown`,
 * which is not a clearance.
 *
 * So the only positive verdict available is `ownSiteVerdict` (`own-site.ts`),
 * and the rule comes out as: the company's own site, established as its own,
 * plus a second website that names it. Everything short of that is a candidate.
 * Never "the website guard did not blank it" — that means nothing condemned the
 * address, which is a different statement from the company owning it.
 *
 * What a site that clears nothing still does is COUNT. A newspaper naming the
 * company is one of the two websites; it just cannot be the one that clears. A
 * host watched filing several of the run's companies counts toward the two as
 * well, and is barred from clearing. Reading either as "so the company is
 * unproven, drop the source" would be a second, quieter way of failing closed.
 *
 * ## Why a watched listing clears nobody, even its apparent owner
 *
 * Ownership is read off the domain alone, so a company named after the very word
 * a business directory registered — "Paginas" at paginas.es — reads as owning
 * that directory. Nothing in the name or the address can tell that apart from a
 * firm genuinely at its own domain, which is a cost `own-site.ts` names and
 * accepts, having nothing better to go on.
 *
 * Here there IS something better: whether the run watched that host file company
 * after company. A site listing the market is a listings site whatever its domain
 * spells, so it clears nobody — including the row whose name it seems to carry.
 * That is the one check able to catch the coincidence, and it fails closed, which
 * is the direction this file is allowed to be wrong in.
 *
 * What it costs is a firm whose own site gives a page to each of its partners.
 * The watch steps over the pages it finds a company owns, so such a host is
 * usually branded on the PARTNERS' pages — and the firm, which plainly exists,
 * is held back for keeping a partner list. Only usually: the watch weighs the
 * names it was handed, and a row it never saw under that name, or a run where it
 * watched nothing, can reach here branded for some other reason. So this rule
 * cannot be relaxed on the strength of "branded means it lists partners".
 *
 * Paid knowingly: a wrongly-confirmed company is the more expensive mistake, and
 * a second website that is not the branded host still clears this firm.
 *
 * ## Two states, never three
 *
 * A row that was never checked reads as a candidate, the same as one that was
 * checked and fell short. Absence of a verdict is not confirmation. What tells
 * the two apart is the reason, which is why running out of money and the check
 * being unavailable are named separately from anything the evidence said: a run
 * that stopped paying has learned nothing about the company, and a reason that
 * reads like a finding would put that learning into a reader's head.
 *
 * ## What must not be folded
 *
 * The independence count folds subdomains, so two pages of one site cannot be
 * two witnesses. The listing verdict must NOT be read off that folded key: it
 * keys on the host as met, because `empresite.eleconomista.es` is a listing
 * while `eleconomista.es` is a newspaper, and folding the first into the second
 * labels a newspaper a directory. The two keys are computed side by side below
 * and are never swapped.
 */

import {
	type DirectorySites,
	filingWords,
	namesTheCompany,
	siteVerdict,
} from './directory-sites'
import {
	DISTINCTIVE_NAME_LENGTH,
	foldTokens,
	hostLabel,
	registrableDomain,
	spellingsWithoutForms,
} from './entity-guard'
import { isPlainObject } from './guard-shapes'
import { ownSiteVerdict } from './own-site'
import type { RunWords } from './run-words'
import { hostOf, isBareWebAddress } from './source-key'

/** Where the row's existence stands. There is no third value. */
export type ExistenceVerdict = 'confirmed' | 'candidate'

/**
 * Why a company is only a candidate.
 *
 * The first three are things the evidence said. The last three are things about
 * the run, and are kept apart from the others on purpose: none of them is a
 * finding about the company, and a reader who cannot tell them apart from one
 * will read a run that stopped early as a run that looked and found nothing.
 *
 * Money and time are named separately for the same reason they are separate
 * from the evidence: they are different things to have run out of, and only one
 * of them is fixed by paying more.
 */
export type CandidateReason =
	/** Nothing usable named the company at all. */
	| 'no_sources'
	/** Only one website named it, however many pages of it were read. */
	| 'one_website'
	/** Two or more websites named it, none established as the company's own. */
	| 'no_own_site'
	/** The run ran out of its verification allowance before reaching this row. */
	| 'budget_exhausted'
	/** The run ran out of time before reaching this row. */
	| 'deadline_reached'
	/** The check could not run — a search provider that was down or errored. */
	| 'checker_unavailable'

/** What was decided about one company, and what it rests on. */
export interface RowExistence {
	readonly verdict: ExistenceVerdict
	/** Absent on a confirmed row, which needs no reason. */
	readonly reason?: CandidateReason
	/** How many independent websites named the company. */
	readonly websites: number
}

/** The field a verdict is written to, so one spelling is read and written. */
const EXISTENCE_KEY = 'existence'

// One source address, read once. `host` is the address as met and `site` the
// domain it is registered under, so the two travel together and neither can be
// mistaken for the other further down. The listing verdict keys on the host as
// met, since `empresite.eleconomista.es` is a listing and `eleconomista.es` is a
// newspaper.
interface SourceSite {
	readonly host: string
	readonly site: string
	readonly own: boolean
	readonly directory: boolean
}

/**
 * The addresses among these values that could actually be fetched off the web.
 *
 * Screened with the STRICT reading, `isBareWebAddress`. A row cites its sources
 * by an opaque id — `src_9f2a1b` — and `hostOf` will happily read that as the
 * site "src_9f2a1b", which would then be a website of its own and could make up
 * the second source that confirms a company. Saying yes here ADDS a source, so
 * a generous reading is the costly direction, the same way `directory-sites.ts`
 * argues it for the addresses it watches.
 */
const webAddressesAmong = (
	values: ReadonlyArray<string>,
): ReadonlyArray<string> => values.filter(isBareWebAddress)

// Every distinct host among these addresses, each read for the two questions
// that decide what it can do: is it this company's own site, and is it a
// listing. Held by the host as met, so two pages of one site are read once.
//
// Named rather than in a row, because the hosts a run watched listing and the
// trades it went looking for are both a set of words and neither reader could
// tell it had been handed the other: every host would read as a listing and no
// trade would be recognised, with nothing to say so.
const sitesOf = (args: {
	readonly name: string
	readonly addresses: ReadonlyArray<string>
	readonly directorySites: DirectorySites
	readonly runWords: RunWords
}): ReadonlyArray<SourceSite> => {
	const { name, addresses, directorySites, runWords } = args
	const byHost = new Map<string, SourceSite>()
	for (const address of addresses) {
		const host = hostOf(address)
		if (host === null || byHost.has(host)) continue
		byHost.set(host, {
			host,
			site: registrableDomain(host),
			own:
				ownSiteVerdict({ name, website: address, runWords }) === 'established',
			directory: siteVerdict(host, directorySites) === 'directory',
		})
	}
	return [...byHost.values()]
}

/**
 * The sites folded into websites, counting a company's own domain under two
 * endings as one.
 *
 * A firm that holds both `acme.es` and `acme.com` would otherwise be two
 * independent websites, and its own site alone would confirm it — the exact
 * thing the two-website rule exists to prevent. So sites sharing a registered
 * label are merged whenever ANY of them is established as this company's own:
 * the label is then the company's, and the endings are one firm's addresses
 * rather than two witnesses.
 *
 * When no site in a label group is the company's own, the group is left alone
 * and each registered domain stands on its own. Two strangers that happen to
 * share a label — a row for "Zeta Instal·lacions" cited on `acme.es` and on
 * `acme.de` — are genuinely two websites, and merging them would withhold a
 * confirmation the evidence supports.
 *
 * Which is why the test is "any of them is own" rather than "all of them":
 * ownership is read off the label, so a host sharing a label with the company's
 * own site spells the company too and is its address as well.
 */
const websitesOf = (
	sites: ReadonlyArray<SourceSite>,
): ReadonlyArray<ReadonlyArray<SourceSite>> => {
	const byLabel = new Map<string, Array<SourceSite>>()
	for (const site of sites) {
		const label = hostLabel(site.host)
		const group = byLabel.get(label) ?? []
		group.push(site)
		byLabel.set(label, group)
	}
	const websites: Array<ReadonlyArray<SourceSite>> = []
	for (const group of byLabel.values()) {
		if (group.some(site => site.own)) {
			websites.push(group)
			continue
		}
		// No own site to bind them: each registered domain stands on its own.
		const bySite = new Map<string, Array<SourceSite>>()
		for (const site of group) {
			const held = bySite.get(site.site) ?? []
			held.push(site)
			bySite.set(site.site, held)
		}
		websites.push(...bySite.values())
	}
	return websites
}

/** How many websites it takes to confirm a company. */
const WEBSITES_THAT_CONFIRM = 2

/**
 * Whether the evidence establishes that this company exists.
 *
 * `sources` are the addresses that named the company — a row's own citations
 * and whatever a verification search turned up. They arrive unscreened; opaque
 * ids and prose are dropped here rather than by every caller.
 *
 * `website` is the row's own website field when it has one, offered as another
 * address. It is not privileged: it clears the company only if it would clear
 * it as a citation, which is to say only if it is established as the company's
 * own site.
 */
export const existenceOf = (args: {
	readonly name: string
	readonly website?: string | undefined
	readonly sources: ReadonlyArray<string>
	readonly directorySites: DirectorySites
	readonly runWords: RunWords
}): RowExistence => {
	const { name, website, directorySites, runWords } = args
	const offered =
		website === undefined || website.trim() === ''
			? args.sources
			: [website, ...args.sources]
	const sites = sitesOf({
		name,
		addresses: webAddressesAmong(offered),
		directorySites,
		runWords,
	})
	const websites = websitesOf(sites)
	// A site has to be this company's own AND not a host the run watched listing
	// the market. Ownership is read off the domain alone, so a company named after
	// a directory reads as owning it; watching that host file company after company
	// is the one thing that catches the coincidence, and a listings site clears
	// nobody however its domain reads.
	const cleared = websites.some(group =>
		group.some(site => site.own && !site.directory),
	)
	if (websites.length >= WEBSITES_THAT_CONFIRM && cleared) {
		return { verdict: 'confirmed', websites: websites.length }
	}
	const reason: CandidateReason =
		websites.length === 0
			? 'no_sources'
			: websites.length < WEBSITES_THAT_CONFIRM
				? 'one_website'
				: 'no_own_site'
	return { verdict: 'candidate', reason, websites: websites.length }
}

/**
 * What a row says about its own existence.
 *
 * A row carrying nothing, or carrying something unreadable, is a candidate. That
 * is the whole of "two states, never three": there is no shape a row can arrive
 * in that reads as confirmed without a verdict actually saying so.
 */
export const rowExistence = (row: Record<string, unknown>): RowExistence => {
	const held = row[EXISTENCE_KEY]
	const stored = isPlainObject(held) ? held : {}
	const websitesHeld = stored['websites']
	const websites = typeof websitesHeld === 'number' ? websitesHeld : 0
	if (stored['verdict'] === 'confirmed')
		return { verdict: 'confirmed', websites }
	const reason = stored['reason']
	return {
		verdict: 'candidate',
		...(typeof reason === 'string'
			? { reason: reason as CandidateReason }
			: {}),
		websites,
	}
}

/** Whether a row is one the run stands behind. */
export const isConfirmedRow = (row: Record<string, unknown>): boolean =>
	rowExistence(row).verdict === 'confirmed'

/** A row with its verdict written on. */
export const withExistence = (
	row: Record<string, unknown>,
	existence: RowExistence,
): Record<string, unknown> => ({ ...row, [EXISTENCE_KEY]: existence })

/**
 * A web search that goes looking for a second website naming this company.
 *
 * The name is quoted so the search treats it as one phrase, and the place is
 * added when the run knows one, exactly as the per-field searches phrase theirs.
 * What it asks for is the company itself rather than any fact about it: the
 * point is to find somebody else who says the company is there.
 */
export const verificationQuery = (
	name: string,
	city: string | undefined,
): string => {
	const place =
		city !== undefined && city.trim() !== '' ? ` ${city.trim()}` : ''
	return `"${name.trim()}"${place}`
}

/**
 * Whether a search result names this company.
 *
 * A search hands back whatever it likes and most of it is about somebody else,
 * so this decides which results become a source for the row that was searched
 * for. Saying yes ADDS a source, and two sources confirm a company — so the
 * reading has to be the one that errs towards saying no, which is the same
 * reading the directory watch holds itself to for the same reason.
 *
 * Each part of the result is read on its own — the title, the snippet, the
 * address's host, and each part of its path separately — and the name has to be
 * spelled exactly by a run of whole words inside one of them. Reading the whole
 * result as one run of words instead lets a name form across a boundary that
 * separates two different things: "…/instalaciones/garcia-hermanos" is a
 * listing's page about Garcia Hermanos filed under a trade, and read end to end
 * it spells "Instalaciones Garcia", a company it has nothing to do with. That
 * shape is what a search for a company most often returns, so the loose reading
 * would manufacture a second source on the most ordinary result there is.
 *
 * The legal form comes off first, because a paper writes "Fusteria Miquel" for
 * the company the register calls "Fusteria Miquel, S.L.". A name with too
 * little left to be distinctive matches nothing rather than everything.
 */
export const resultNamesCompany = (
	name: string,
	result: {
		readonly title: string
		readonly snippet: string
		readonly url: string
	},
): boolean => {
	// Every way an address or a headline might write the name, not just the one
	// this row wrote it in: a Catalan name carrying a geminate, or a legal form
	// spelled with dots, reaches the page under a spelling the row never used.
	// The same reading the directory watch files a company under, so one run
	// cannot recognise a company in an address and fail to recognise it here.
	const spellings = spellingsWithoutForms(name).filter(
		spelling => spelling.length >= DISTINCTIVE_NAME_LENGTH,
	)
	if (spellings.length === 0) return false
	const host = hostOf(result.url)
	const parts: ReadonlyArray<ReadonlyArray<string>> = [
		foldTokens(result.title),
		foldTokens(result.snippet),
		...(host === null ? [] : [foldTokens(hostLabel(host))]),
		...filingWords(result.url),
	]
	return parts.some(words =>
		spellings.some(spelling => namesTheCompany(words, spelling)),
	)
}

/**
 * Write a verdict onto every row of a scan's list.
 *
 * The verdict goes on the row, and the two groups are worked out by whoever
 * reads it. `existenceAt` is asked per row in list order, so a caller can hand
 * back what it worked out for that row without matching rows up again.
 *
 * Only the list at the top of the findings is touched, and only its rows that
 * are objects — the same reading `discoveryRows` does. The other guards walk
 * the whole tree for their key, which is safe for them because they judge each
 * row on what the row itself holds. This one is handed answers worked out
 * beforehand and looked up by position, so it has to walk exactly the list
 * those answers were worked out from. A `proposed_updates` entry carries a
 * free-form blob that decodes to whatever the model wrote, a key of this name
 * included, and a deeper list would restart the count and hand row one's answer
 * to a stranger.
 */
export const markRowsExistence = (
	findings: unknown,
	listField: string,
	existenceAt: (row: Record<string, unknown>, index: number) => RowExistence,
): unknown => {
	if (!isPlainObject(findings)) return findings
	const rows = findings[listField]
	if (!Array.isArray(rows)) return findings
	let at = -1
	return {
		...findings,
		[listField]: rows.map(row => {
			if (!isPlainObject(row)) return row
			at++
			return withExistence(row, existenceAt(row, at))
		}),
	}
}

/**
 * The two groups a caller reports, derived from the one list rather than stored
 * as two.
 *
 * Storing them apart would be the same decision made once in the schema instead
 * of once per row, and it would delete the candidates: a scan whose primary list
 * came back empty is rewritten to a terminal "found nothing" over its own
 * findings, so a shape that moved the candidates to a second array would lose
 * every one of them. Deriving keeps them where the rest of the run can see them.
 */
export const partitionByExistence = (
	rows: ReadonlyArray<Record<string, unknown>>,
): {
	readonly confirmed: ReadonlyArray<Record<string, unknown>>
	readonly candidates: ReadonlyArray<Record<string, unknown>>
} => ({
	confirmed: rows.filter(isConfirmedRow),
	candidates: rows.filter(row => !isConfirmedRow(row)),
})
