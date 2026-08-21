/**
 * Blanks a company's `website` when it points at someone else's directory listing
 * rather than the company's own site.
 *
 * A richer search turns up profile pages on aggregators — "cbinsights.com/company/
 * redwood-logistics", a directory's page ABOUT the company — and the model, asked
 * for a website, sometimes hands one back. Shipped, that lands a stranger's URL in
 * the CRM's website field. The scan schemas make this easy to miss: a scan has no
 * single subject, so the source-tier guard (which only ever lowers confidence) skips
 * it entirely, and the `website` is a plain string with no attached source for any
 * other guard to weigh.
 *
 * The rule blanks a website only when it is clearly not the company's own:
 *  - the value is not a web address at all, or
 *  - its host is one this run watched file several of its own companies, or
 *  - its host does not carry the company's name AND the name sits in a deeper part
 *    of the address — the shape of "someone-else.com/company/<the-company>", which
 *    is a listing, never a company's own home page, or
 *  - its host does not carry the company's name AND other companies the run has
 *    read claim that host as theirs too, or
 *  - nothing in the address names the company anywhere AND the address is the one
 *    page every source the row cites points at — the field holding the page the
 *    claim was read from rather than the site that page sits on.
 * Anything else is kept: a company's own site names it in the host ("acme.com") or
 * describes itself in the first path segment ("xpo.com/about-xpo-logistics"), and a
 * blank costs a real website, so the bar to blank is deliberately high.
 *
 * Every one of those rules only ever BLANKS. None of them can say a website is
 * the company's own, so "kept" means "not condemned" and a caller reading it as
 * ownership answers yes out of silence. That question has its own answer next
 * door — `ownSiteVerdict` in `own-site.ts` — and every website this leaves
 * standing is put to it, so the counts below say not only how many addresses
 * went but how many of the survivors anything actually establishes. Like the
 * blank counts beside them, they describe the answer handed to THIS call. A run
 * that extracts several times and folds the results together has to put the
 * folded answer to the verdict itself.
 *
 * The address rule and the deeper-path rule read only a name and a website, so they
 * need no evidence corpus and no database. They fire on any object carrying both —
 * a scanned competitor or prospect — and on the run's own answer for the target's
 * website, which arrives on its own with no name beside it and so is judged against
 * the target's name passed in. The read-page rule reads one more thing off the same
 * row, the sources it cites, which travel with it. The shared-host rule asks about
 * every answer the run has read rather than one row, which is why the walk below is
 * preceded by a reading pass that gathers who claims which host, and why what it
 * gathered comes back out with the result so the next call can be handed it; the
 * directory rule asks about the whole RUN, and is handed its answer from outside
 * (see `directory-sites.ts`).
 */

import { type DirectorySites, siteVerdict } from './directory-sites'
import {
	collapse,
	DISTINCTIVE_NAME_LENGTH,
	distinctiveWords,
	namesNobodyInParticular,
	spellingsWithoutForms,
} from './entity-guard'
import { citedSourceIds, isPlainObject } from './guard-shapes'
import { ownSiteHostVerdict, ownSiteVerdict } from './own-site'
import { hostOf, isBareWebAddress, pathOf } from './source-key'
import type { TradeWords } from './trade-words'

const SKIP_KEYS = new Set(['citations', 'proposed_updates'])

// A part of an address put back into letters. A Spanish or Catalan listing writes
// the accents of a name it files as escapes, and a name looked for through them
// spells nothing; a part that was never valid escaping is read as it stands rather
// than dropped. Decoded part by part, so an escaped slash cannot invent a part
// that was never there.
const withoutEscapes = (segment: string): string => {
	try {
		return decodeURIComponent(segment)
	} catch {
		return segment
	}
}

// The parts of the address after the host — ["company", "redwood-logistics"] from
// "cbinsights.com/company/redwood-logistics". A scheme is added when missing, since
// a model often writes a bare host.
const pathSegmentsOf = (website: string): ReadonlyArray<string> => {
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(website)
		? website
		: `https://${website}`
	try {
		return new URL(withScheme).pathname
			.split('/')
			.filter(Boolean)
			.map(withoutEscapes)
	} catch {
		return []
	}
}

// Whether the address mentions the company anywhere in it — in the host or in any
// part of the path, the first part included. Read as loosely as anything here reads
// a name: the whole name with its legal form taken out, or any one distinctive word
// of it, found anywhere inside. Loose on purpose, because a mention only ever
// withholds the blank below: reading it loosely costs that rule its reach, never a
// company its site.
//
// The host and the parts are handed in rather than read again, so this cannot come
// to a different reading of the same address than the rules above did.
const addressNamesCompany = (
	name: string,
	host: string,
	segments: ReadonlyArray<string>,
): boolean => {
	const parts = [collapse(host), ...segments.map(collapse)]
	const spellings = spellingsWithoutForms(name)
	const words = distinctiveWords(name)
	return parts.some(
		part =>
			spellings.some(spelling => part.includes(spelling)) ||
			words.some(word => part.includes(word)),
	)
}

// A page, told from the site it sits on: the path with any trailing slash off. The
// query is left out, because a page is the same page whichever tracking parameters
// were on the link that reached it.
const pageOf = (url: string): string => (pathOf(url) ?? '').replace(/\/+$/, '')

// Whether two addresses are the same page, however each side spelled it — a model
// writes the site with a scheme and cites it without one, or one of the two keeps
// its trailing slash.
//
// Not `canonicalizeUrl`, which is how the rest of the package settles whether two
// addresses are one: it hands back the string untouched when the address has no
// scheme, so a citation tidied down to "acme.es/x" would never be found to be the
// same page as "https://acme.es/x" — the very spelling a model reaches for. Reading
// the host and the path apart handles both spellings, because both readers add a
// scheme when one is missing.
const samePage = (one: string, other: string): boolean => {
	const host = hostOf(one)
	return (
		host !== null && host === hostOf(other) && pageOf(one) === pageOf(other)
	)
}

// Whether the row cites nothing but this one page: the website field holding where
// the claim came from, with nothing else having mentioned the company at all. A row
// that cites nothing says nothing either way.
const citesNothingButThisPage = (
	website: string,
	citedSources: ReadonlyArray<string>,
): boolean =>
	citedSources.length > 0 &&
	citedSources.every(source => samePage(website, source))

/**
 * Who claims which host: a host mapped to every company that gave it as its
 * website. Gathered before anything is rewritten, because "is this host any one
 * company's own?" cannot be answered from one row. A value that is not an
 * address, or a name with nothing distinctive in it, tells us nothing about who
 * a host belongs to and is left out.
 *
 * Each company is held under the one name it is written by, with every writing
 * of it this host has been claimed under alongside. Held that way rather than as
 * a flat set of names, because the shared-host rule counts these to ask how many
 * companies claim a host: a Catalan name an address can write two ways would
 * otherwise be two of them on its own, and one company would look like a crowd.
 *
 * The names are kept as written rather than folded down to what an address would
 * spell, because the stand-down below puts each of them to `own-site.ts`, and
 * that reader weighs a name's words and its shorter forms — none of which
 * survives the folding.
 *
 * The pages are kept beside them because where on a host a company was filed is
 * what tells a listing from a site: a trade body gives each member a page of its
 * own, while a company met under two names is one page written down twice.
 *
 * Exported because a run reads several answers and folds them into one, and the
 * claims have to outlive each reading — see `guardCompanyWebsites`.
 */
export interface HostClaim {
	/** Every writing of the company this host has been claimed under. */
	readonly names: ReadonlyArray<string>
	/** Every page of this host it was given, the site itself being the empty one. */
	readonly pages: ReadonlyArray<string>
}

export type HostClaims = ReadonlyMap<string, ReadonlyMap<string, HostClaim>>

const collectHostClaims = (
	findings: unknown,
	prior: HostClaims,
): HostClaims => {
	const claims = new Map<string, Map<string, HostClaim>>()
	// What earlier readings claimed, carried in as if it had been read here. A
	// company that claimed a host in an earlier reading still claims it: nothing
	// a later reading says takes that back, and the rule below is the one thing
	// that needs both claimants at once.
	for (const [host, claimants] of prior) claims.set(host, new Map(claimants))
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const item of value) visit(item)
			return
		}
		if (!isPlainObject(value)) return
		const name = value['name']
		const website = value['website']
		if (typeof name === 'string' && typeof website === 'string') {
			const host = isBareWebAddress(website) ? hostOf(website) : null
			const spellings = spellingsWithoutForms(name)
			const identity = spellings[0]
			if (host !== null && identity !== undefined) {
				const claimants = claims.get(host) ?? new Map<string, HostClaim>()
				// Every writing this company has been claimed under on this host, and
				// every page of it the company was given — not just the last row's. Two
				// rows of one company can spell it differently, one with the geminate
				// mark and one without, and taking only the later row would drop the
				// writing that recognises the company's own host, which is what stands
				// the rule below down.
				const held = claimants.get(identity)
				claimants.set(identity, {
					names: [...new Set([...(held?.names ?? []), name])],
					pages: [...new Set([...(held?.pages ?? []), pageOf(website)])],
				})
				claims.set(host, claimants)
			}
		}
		for (const [childKey, child] of Object.entries(value)) {
			if (!SKIP_KEYS.has(childKey)) visit(child)
		}
	}
	visit(findings)
	return claims
}

// Whether two claimants are plainly DIFFERENT companies. One host cannot be two
// different companies' own site, and that is the whole premise of the rule below
// — but two claimants that are one company written two ways are not two
// companies, and reading them as such turns a firm's own site into a host nobody
// owns and takes the address off both its rows.
//
// A firm writes its name with a word in front on one page and without it on
// another — "SIMIE" beside "Groupe SIMIE" — and each writing arrives as its own
// claimant. So a claimant whose distinctive words all appear in another's is
// that other one met again rather than somebody new. Read on the words rather
// than on the letters, because the added word can sit anywhere in the name.
//
// A name with no distinctive word in it says nothing about who it is, so it
// nests into nobody and is counted on its own — the same withholding every
// reading of a name here makes when it has nothing to read.
const differentCompanies = (one: HostClaim, other: HostClaim): boolean => {
	const wordsOf = (claim: HostClaim): ReadonlySet<string> =>
		new Set(claim.names.flatMap(name => distinctiveWords(name)))
	const nests = (
		inner: ReadonlySet<string>,
		outer: ReadonlySet<string>,
	): boolean => inner.size > 0 && [...inner].every(word => outer.has(word))
	const ours = wordsOf(one)
	const theirs = wordsOf(other)
	return !nests(ours, theirs) && !nests(theirs, ours)
}

// Whether the host filed these two apart, which is what a site listing companies
// does: a trade body gives each member a page of its own ("aemiat.com/e-mora/"
// beside "aemiat.com/rubio/"). Two claimants on the SAME page are one page
// written down twice — the ordinary shape of a company met under two names, each
// row recording the site it publishes — and that is no evidence the host files
// anybody.
const filedApart = (one: HostClaim, other: HostClaim): boolean =>
	one.pages.some(page => !other.pages.includes(page)) ||
	other.pages.some(page => !one.pages.includes(page))

// Whether a host is filing companies rather than being one company's site: some
// two of its claimants are different companies AND it gave them different pages.
const filesSeveralCompanies = (
	claimants: ReadonlyMap<string, HostClaim>,
): boolean => {
	const claims = [...claimants.values()]
	return claims.some((one, at) =>
		claims
			.slice(at + 1)
			.some(other => differentCompanies(one, other) && filedApart(one, other)),
	)
}

// Whether a host plainly belongs to one of the companies claiming it, asked two
// ways because neither reading contains the other.
//
// The host carrying the name is the loose reading: "acme-directory.com" carries
// "Acme" and belongs to somebody else. It is kept because a wrong yes here only
// withholds a blank, and a blank costs a real website. A name too short to mean
// anything is left out of it, or it would quietly switch the rule off for every
// row on the host.
//
// The domain being established as that company's own is the reading the rest of
// the run uses, and it reaches what the first one cannot: a firm registers the
// front of its name or the one word people use it by, so "XPO Logistics" is at
// xpo.com and "Transportes García" at garcia.es — neither of which carries the
// whole name. Without it, one company met under two names on a domain like that
// reads as two companies sharing a stranger's host, and both lose a site that
// really is theirs.
const hostBelongsTo = (
	host: string,
	claimantNames: ReadonlyArray<string>,
	tradeWords: TradeWords,
): boolean =>
	claimantNames.some(
		name =>
			spellingsWithoutForms(name).some(
				spelling =>
					spelling.length >= DISTINCTIVE_NAME_LENGTH &&
					collapse(host).includes(spelling),
			) || ownSiteHostVerdict({ name, host, tradeWords }) === 'established',
	)

type WebsiteVerdict =
	| 'keep'
	| 'not_an_address'
	| 'directory'
	| 'profile_page'
	| 'shared_host'
	| 'read_page'

// Where a website really points, for a company by this name.
const classifyWebsite = (args: {
	readonly name: string
	readonly website: string
	readonly citedSources: ReadonlyArray<string>
	readonly hostClaims: HostClaims
	readonly directorySites: DirectorySites
	readonly tradeWords: TradeWords
}): WebsiteVerdict => {
	const {
		name,
		website,
		citedSources,
		hostClaims,
		directorySites,
		tradeWords,
	} = args
	const host = hostOf(website)
	// Not an address at all: a value with words written next to it ("https://acme.es
	// (inferred from the name)"), or something that was never a URL. A website field
	// holding prose is worse than an empty one — nobody can open it, and it reads as
	// a real site to everything downstream.
	if (host === null || !isBareWebAddress(website)) return 'not_an_address'
	// A host this run watched file several of its own companies. Any other host is
	// `unknown`, which is no reason to blank a website and no clearance either — the
	// rules below still have their say.
	if (siteVerdict(host, directorySites) === 'directory') return 'directory'
	// The name as an address would write it: a directory files a company under its
	// trading name and leaves the legal form out, so the form is taken out here
	// too, wherever in the name it sits. This asks whether the address names the
	// company, which is a looser question than who the company is.
	const spellings = spellingsWithoutForms(name)
	// With no distinctive name to look for, there is no way to tell a listing from
	// the company's own site, so keep it.
	if (spellings.length === 0) return 'keep'
	// The host itself carries the company's name — its own site, whatever the path.
	if (spellings.some(spelling => collapse(host).includes(spelling)))
		return 'keep'
	// The name appears only in a deeper path segment of a host that is not the
	// company's: the signature of a directory's page about it. The first segment is
	// excluded, because a company's own site describes itself right there
	// ("xpo.com/about-xpo-logistics") while a directory files it one level down
	// ("company/<name>").
	const segments = pathSegmentsOf(website)
	if (
		segments
			.slice(1)
			.some(segment =>
				spellings.some(spelling => collapse(segment).includes(spelling)),
			)
	) {
		return 'profile_page'
	}
	// A host several DIFFERENT companies call their own, and that none of them is
	// named by. A trade body's member directory gives each member a page at the top
	// level ("aemiat.com/<member>/"), which the first-segment exemption above reads as a
	// company describing itself on its own site — right for "xpo.com/about-xpo",
	// wrong here. What separates the two is not the address but the companies beside
	// it: one host cannot be four different companies' own site, and a host that is
	// filing them gives each one a page of its own.
	//
	// One of them being named by the host changes the answer completely: the host is
	// then plainly that company's, and the other rows on it are the same company met
	// again under its other name — a trade name beside a legal one. Blanking those
	// would take away the very site that says the two rows are one company.
	//
	// The claimants need not have arrived together. A run reads its list several
	// times and folds the readings into one, so the trade body's two members can
	// each be alone in the answer they arrive in; what makes them a crowd is the
	// run having read both, which is what `priorClaims` carries.
	//
	// Whose host it is comes from `own-site.ts`, the one answer the rest of the run
	// uses, with the looser reading beside it — see `hostBelongsTo`. Both only ever
	// hold this rule back, which is the direction a website check is allowed to be
	// wrong in.
	const claimants = hostClaims.get(host)
	if (
		claimants !== undefined &&
		filesSeveralCompanies(claimants) &&
		![...claimants.values()].some(claimant =>
			hostBelongsTo(host, claimant.names, tradeWords),
		)
	) {
		return 'shared_host'
	}
	// A page on somebody's host, which is the very page this row's claim was read
	// from, and which names the company nowhere. Reading a page and writing down the
	// site it sits on is the ordinary case — "acme.com/about" read, "acme.com"
	// recorded — and what is missing here is exactly that step: what was recorded is
	// the reading material itself, on a host that says nothing about who owns it. So
	// nothing in the row establishes that the company owns the address, and its own
	// citation says only that the run read the page.
	//
	// That is what a directory's listing page looks like from inside the answer, and
	// every rule above needs something it withholds: one company on the host, a slug
	// naming a trade instead of a company, and the first-segment
	// exemption letting that slug through without ever asking whether it names the
	// company at all. This asks.
	//
	// A bare host is left alone even when it is the page that was read. With no path
	// there is no page to tell apart from the site, so the tell is absent and what
	// is left is the ordinary case again.
	if (
		segments.length > 0 &&
		citesNothingButThisPage(website, citedSources) &&
		!addressNamesCompany(name, host, segments)
	) {
		return 'read_page'
	}
	return 'keep'
}

export interface WebsiteGuardResult {
	/** The findings, with every website that is not the company's own removed. */
	readonly findings: unknown
	/** Websites blanked because the value was not a web address. */
	readonly blankedNotAnAddress: number
	/** Websites blanked because their host was watched filing several companies. */
	readonly blankedDirectory: number
	/** Websites blanked because the name sat in a deeper path of another host. */
	readonly blankedProfilePage: number
	/** Websites blanked because other companies in the answer claim the same host. */
	readonly blankedSharedHost: number
	/** Websites blanked because they were the page the row's claim was read from. */
	readonly blankedReadPage: number
	/** Websites left standing that are established as the company's own site. */
	readonly ownSiteEstablished: number
	/**
	 * Websites left standing that nothing establishes as the company's own. Kept,
	 * because keeping is not that verdict's decision — but a caller weighing a
	 * company's sources may not count one of these as its own site.
	 */
	readonly ownSiteUnknown: number
	/**
	 * Websites judged against a name holding no word of the company's own —
	 * "Grupo Express SL", which says a kind of company and a trade and no more.
	 *
	 * Counted so the numbers above can be read honestly, because these rows were
	 * judged on less than the rest: nothing can establish their site (there is no
	 * word for a domain to spell, so even grupoexpress.cat lands in
	 * `ownSiteUnknown`), and the rules that weigh an address against a name have
	 * only the whole name to go on. Their `unknown` therefore means "could never
	 * have been anything else", not "nothing vouched for it", and the two must
	 * not be added up as if they were one answer.
	 */
	readonly namedNobodyInParticular: number
	/**
	 * Who claimed which host — this answer's claims and every earlier call's,
	 * recorded as claimed and before any rule blanked anything.
	 *
	 * Handed back so the next call can be given it, which is what lets the
	 * shared-host rule weigh two claimants that never appeared in the same
	 * answer.
	 */
	readonly hostClaims: HostClaims
}

/**
 * `targetName` is the company the run is about, for the one website that is the
 * run's own answer for it rather than a scanned stranger's. That field sits alone —
 * a value with the page it came from and no company name beside it — so without the
 * name told from outside, every rule that reads a name has nothing to compare and
 * only the address rule and the directory rule are left. Pass it: a run about one
 * named company observes no directories either, since telling one takes a list of
 * companies to watch a host file, and such a run has one company.
 *
 * `directorySites` are the hosts the run itself watched behave like a listing. It
 * defaults to none, which costs only that rule: a run that gathered nothing to
 * watch still gets every rule that reads a name and an address.
 *
 * `priorClaims` is what earlier calls read — `hostClaims` off their result. It
 * defaults to none, which is one answer judged on its own. A run that extracts
 * several times and folds the results together has to pass it, and has to judge
 * the folded list too: each answer is judged alone and then merged, so a member
 * page condemned for one company while its neighbour was in another answer is
 * standing on the list that ships, and no reading of that list can recover the
 * claim that condemned it. Recorded claims can, because they are taken before
 * the blanking.
 *
 * `tradeWords` are the trades the run went looking for (`trade-words.ts`), which
 * is how the ownership reading tells the trade in a company's name from the
 * company. Asked for on every call rather than defaulted to none, unlike the
 * three above: leaving it out does not merely stand a rule down, it makes this
 * guard read the same address differently from the rest of the run.
 */
export const guardCompanyWebsites = (args: {
	readonly findings: unknown
	readonly targetName?: string | undefined
	readonly directorySites?: DirectorySites | undefined
	readonly priorClaims?: HostClaims | undefined
	readonly tradeWords: TradeWords
}): WebsiteGuardResult => {
	const {
		findings,
		targetName,
		directorySites = new Set<string>(),
		priorClaims = new Map(),
		tradeWords,
	} = args
	let blankedNotAnAddress = 0
	let blankedDirectory = 0
	let blankedProfilePage = 0
	let blankedSharedHost = 0
	let blankedReadPage = 0
	let ownSiteEstablished = 0
	let ownSiteUnknown = 0
	let namedNobodyInParticular = 0
	const hostClaims = collectHostClaims(findings, priorClaims)

	// A name the guard could read, holding no word of the company's own. Counted
	// as the website is judged rather than by its verdict, because what it records
	// is how much the rules had to go on — which is the same whichever way they
	// then went. A name with nothing readable in it at all is a different miss and
	// is not counted here.
	const countNamedNobodyInParticular = (name: string): void => {
		if (spellingsWithoutForms(name).length > 0 && namesNobodyInParticular(name))
			namedNobodyInParticular++
	}

	// Ask the survivor the question none of the rules above can answer, and keep
	// the answer beside their counts. Asked only of a website that is staying,
	// since one already gone has no ownership left to establish.
	const countOwnSite = (name: string, website: string): void => {
		if (ownSiteVerdict({ name, website, tradeWords }) === 'established')
			ownSiteEstablished++
		else ownSiteUnknown++
	}

	const count = (verdict: Exclude<WebsiteVerdict, 'keep'>): void => {
		if (verdict === 'not_an_address') blankedNotAnAddress++
		else if (verdict === 'directory') blankedDirectory++
		else if (verdict === 'profile_page') blankedProfilePage++
		else if (verdict === 'shared_host') blankedSharedHost++
		// Named rather than left as the remaining case, so a verdict added later is
		// not quietly added to this one's total.
		else if (verdict === 'read_page') blankedReadPage++
	}

	// Walk one child, honouring the key it sits under: the proposed-update and
	// citation subtrees hold their own `name` (a person's, on a contact proposal)
	// and must not have it matched against a host, so they are copied through whole.
	const walkChild = (key: string, value: unknown): unknown =>
		SKIP_KEYS.has(key) ? value : walk(value, key)

	function walk(value: unknown, key?: string): unknown {
		if (Array.isArray(value)) return value.map(item => walk(item))
		if (!isPlainObject(value)) return value

		// The run's own answer for the target's website: a value carrying the page it
		// was read from, under the `website` key, with no company name beside it. The
		// page it came from is that one source, so the field is its own citation list.
		//
		// Which makes the read-page rule stricter here than it is on a scanned row: a
		// row with a second source elsewhere stands that rule down, and this field can
		// never have one, so the address naming the company is the only thing holding
		// the value. A company whose own domain spells no part of its name loses a real
		// page it published — the cost this file keeps paying for a high bar elsewhere,
		// and the one place the bar is lower than the rest.
		if (
			key === 'website' &&
			typeof value['value'] === 'string' &&
			typeof value['name'] !== 'string'
		) {
			countNamedNobodyInParticular(targetName ?? '')
			const verdict = classifyWebsite({
				name: targetName ?? '',
				website: value['value'],
				citedSources:
					typeof value['source_id'] === 'string' ? [value['source_id']] : [],
				hostClaims,
				directorySites,
				tradeWords,
			})
			if (verdict !== 'keep') {
				count(verdict)
				// Emptied rather than removed: the field is the whole object here, and
				// a reader of the profile still needs to see the key was asked for.
				return null
			}
			countOwnSite(targetName ?? '', value['value'])
			return value
		}

		const name = value['name']
		const website = value['website']
		if (typeof name === 'string' && typeof website === 'string') {
			countNamedNobodyInParticular(name)
			const verdict = classifyWebsite({
				name,
				website,
				citedSources: citedSourceIds(value),
				hostClaims,
				directorySites,
				tradeWords,
			})
			if (verdict !== 'keep') {
				count(verdict)
				// Drop the key entirely, so the value reads as one the model never
				// gave — the same as any other field a guard removes.
				const { website: _dropped, ...rest } = value
				return Object.fromEntries(
					Object.entries(rest).map(([k, v]) => [k, walkChild(k, v)] as const),
				)
			}
			countOwnSite(name, website)
		}

		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, walkChild(k, v)] as const),
		)
	}

	return {
		findings: walk(findings),
		blankedNotAnAddress,
		blankedDirectory,
		blankedProfilePage,
		blankedSharedHost,
		blankedReadPage,
		ownSiteEstablished,
		ownSiteUnknown,
		namedNobodyInParticular,
		hostClaims,
	}
}
