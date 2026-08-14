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
 *  - its host is a directory we already know (a short, evidence-driven list), or
 *  - its host does not carry the company's name AND the name sits in a deeper part
 *    of the address — the shape of "someone-else.com/company/<the-company>", which
 *    is a listing, never a company's own home page, or
 *  - its host does not carry the company's name AND other companies in the same
 *    answer claim that host as theirs too.
 * Anything else is kept: a company's own site names it in the host ("acme.com") or
 * describes itself in the first path segment ("xpo.com/about-xpo-logistics"), and a
 * blank costs a real website, so the bar to blank is deliberately high.
 *
 * All but the last rule read only a name and a website, so they need no evidence
 * corpus and no database. They fire on any object carrying both — a scanned
 * competitor or prospect — and on the run's own answer for the target's website,
 * which arrives on its own with no name beside it and so is judged against the
 * target's name passed in. The last rule is the only one that asks about the whole
 * answer rather than one row, which is why the walk below is preceded by a reading
 * pass that gathers who claims which host.
 */

import { collapse, nameWithoutForms } from './entity-guard'
import { isPlainObject } from './guard-shapes'
import { hostOf, isBareWebAddress } from './source-key'

// Directories whose company-profile pages a model most often mistakes for a
// company's own site. This is a shortcut, not the defence: an unlisted directory
// is still caught by the name-in-a-deeper-path rule below, so adding a host here
// only makes the common cases cheaper — it is never the thing standing between a
// listing and the CRM.
const AGGREGATOR_HOSTS = new Set([
	'cbinsights.com',
	'crunchbase.com',
	'zoominfo.com',
	'owler.com',
	'dnb.com',
	'dun-bradstreet.com',
	'pitchbook.com',
	'datanyze.com',
])

const SKIP_KEYS = new Set(['citations', 'proposed_updates'])

// The site sits on a known directory's host, or a subdomain of one
// ("research.owler.com").
const isAggregatorHost = (host: string): boolean =>
	[...AGGREGATOR_HOSTS].some(
		aggregator => host === aggregator || host.endsWith(`.${aggregator}`),
	)

// The parts of the address after the host — ["company", "redwood-logistics"] from
// "cbinsights.com/company/redwood-logistics". A scheme is added when missing, since
// a model often writes a bare host.
const pathSegmentsOf = (website: string): ReadonlyArray<string> => {
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(website)
		? website
		: `https://${website}`
	try {
		return new URL(withScheme).pathname.split('/').filter(Boolean)
	} catch {
		return []
	}
}

// Who claims which host, across a whole answer: a host mapped to the name cores of
// every company that gave it as its website. Gathered before anything is rewritten,
// because "is this host any one company's own?" cannot be answered from one row.
// A value that is not an address, or a name with nothing distinctive in it, tells
// us nothing about who a host belongs to and is left out.
type HostClaims = ReadonlyMap<string, ReadonlySet<string>>

const collectHostClaims = (findings: unknown): HostClaims => {
	const claims = new Map<string, Set<string>>()
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
			const core = nameWithoutForms(name)
			if (host !== null && core !== '') {
				const claimants = claims.get(host) ?? new Set<string>()
				claimants.add(core)
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

// The shortest name that can vouch for a host on its own. Two or three letters
// turn up inside an unrelated address by coincidence — "it" sits inside
// "digital.es" — and one company vouching for a host is what stands the
// shared-host rule down for every row on it, so a coincidence there would quietly
// switch the rule off. Four matches the bar the entity checks already set for a
// word distinctive enough to go on.
const VOUCHING_NAME_LENGTH = 4

const hostBelongsTo = (host: string, claimant: string): boolean =>
	claimant.length >= VOUCHING_NAME_LENGTH && collapse(host).includes(claimant)

type WebsiteVerdict =
	| 'keep'
	| 'not_an_address'
	| 'directory'
	| 'profile_page'
	| 'shared_host'

// Where a website really points, for a company by this name.
const classifyWebsite = (
	name: string,
	website: string,
	hostClaims: HostClaims,
): WebsiteVerdict => {
	const host = hostOf(website)
	// Not an address at all: a value with words written next to it ("https://acme.es
	// (inferred from the name)"), or something that was never a URL. A website field
	// holding prose is worse than an empty one — nobody can open it, and it reads as
	// a real site to everything downstream.
	if (host === null || !isBareWebAddress(website)) return 'not_an_address'
	if (isAggregatorHost(host)) return 'directory'
	// The name as an address would write it: a directory files a company under its
	// trading name and leaves the legal form out, so the form is taken out here
	// too, wherever in the name it sits. This asks whether the address names the
	// company, which is a looser question than who the company is.
	const core = nameWithoutForms(name)
	// With no distinctive name to look for, there is no way to tell a listing from
	// the company's own site, so keep it.
	if (core === '') return 'keep'
	// The host itself carries the company's name — its own site, whatever the path.
	if (collapse(host).includes(core)) return 'keep'
	// The name appears only in a deeper path segment of a host that is not the
	// company's: the signature of a directory's page about it. The first segment is
	// excluded, because a company's own site describes itself right there
	// ("xpo.com/about-xpo-logistics") while a directory files it one level down
	// ("company/<name>").
	const deeperSegments = pathSegmentsOf(website).slice(1)
	if (deeperSegments.some(segment => collapse(segment).includes(core))) {
		return 'profile_page'
	}
	// A host several companies in this answer call their own, and that none of them
	// is named by. A trade body's member directory gives each member a page at the
	// top level ("aemiat.com/<member>/"), which the first-segment exemption above
	// reads as a company describing itself on its own site — right for
	// "xpo.com/about-xpo", wrong here. What separates the two is not the address but
	// the companies beside it: one host cannot be four different companies' own
	// site, and the four names saying so are in the same list.
	//
	// One of them being named by the host changes the answer completely: the host is
	// then plainly that company's, and the other rows on it are the same company met
	// again under its other name — a trade name beside a legal one. Blanking those
	// would take away the very site that says the two rows are one company.
	const claimants = hostClaims.get(host)
	if (
		claimants !== undefined &&
		claimants.size > 1 &&
		![...claimants].some(claimant => hostBelongsTo(host, claimant))
	) {
		return 'shared_host'
	}
	return 'keep'
}

export interface WebsiteGuardResult {
	/** The findings, with every website that is not the company's own removed. */
	readonly findings: unknown
	/** Websites blanked because the value was not a web address. */
	readonly blankedNotAnAddress: number
	/** Websites blanked because their host is a known directory. */
	readonly blankedDirectory: number
	/** Websites blanked because the name sat in a deeper path of another host. */
	readonly blankedProfilePage: number
	/** Websites blanked because other companies in the answer claim the same host. */
	readonly blankedSharedHost: number
}

/**
 * `targetName` is the company the run is about, for the one website that is the
 * run's own answer for it rather than a scanned stranger's. That field sits alone —
 * a value with the page it came from and no company name beside it — so without the
 * name told from outside, the two name-based rules have nothing to compare and only
 * the known-directory rule can fire. Leave it out and that is exactly what happens,
 * which is still the check this guard exists for.
 */
export const guardCompanyWebsites = (
	findings: unknown,
	targetName?: string,
): WebsiteGuardResult => {
	let blankedNotAnAddress = 0
	let blankedDirectory = 0
	let blankedProfilePage = 0
	let blankedSharedHost = 0
	const hostClaims = collectHostClaims(findings)

	const count = (verdict: Exclude<WebsiteVerdict, 'keep'>): void => {
		if (verdict === 'not_an_address') blankedNotAnAddress++
		else if (verdict === 'directory') blankedDirectory++
		else if (verdict === 'profile_page') blankedProfilePage++
		else blankedSharedHost++
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
		// was read from, under the `website` key, with no company name beside it.
		if (
			key === 'website' &&
			typeof value['value'] === 'string' &&
			typeof value['name'] !== 'string'
		) {
			const verdict = classifyWebsite(
				targetName ?? '',
				value['value'],
				hostClaims,
			)
			if (verdict !== 'keep') {
				count(verdict)
				// Emptied rather than removed: the field is the whole object here, and
				// a reader of the profile still needs to see the key was asked for.
				return null
			}
			return value
		}

		const name = value['name']
		const website = value['website']
		if (typeof name === 'string' && typeof website === 'string') {
			const verdict = classifyWebsite(name, website, hostClaims)
			if (verdict !== 'keep') {
				count(verdict)
				// Drop the key entirely, so the value reads as one the model never
				// gave — the same as any other field a guard removes.
				const { website: _dropped, ...rest } = value
				return Object.fromEntries(
					Object.entries(rest).map(([k, v]) => [k, walkChild(k, v)] as const),
				)
			}
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
	}
}
