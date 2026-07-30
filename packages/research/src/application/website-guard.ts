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
 *  - its host is a directory we already know (a short, evidence-driven list), or
 *  - its host does not carry the company's name AND the name sits in a deeper part
 *    of the address — the shape of "someone-else.com/company/<the-company>", which
 *    is a listing, never a company's own home page.
 * Anything else is kept: a company's own site names it in the host ("acme.com") or
 * describes itself in the first path segment ("xpo.com/about-xpo-logistics"), and a
 * blank costs a real website, so the bar to blank is deliberately high.
 *
 * It reads only a name and a website, so it needs no evidence corpus and no
 * database. It fires on any object carrying both — a scanned competitor or prospect
 * — and on the run's own answer for the target's website, which arrives on its own
 * with no name beside it and so is judged against the target's name passed in.
 */

import { collapse, nameCore } from './entity-guard'
import { isPlainObject } from './guard-shapes'
import { hostOf } from './source-key'

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

type WebsiteVerdict = 'keep' | 'directory' | 'profile_page'

// Where a website really points, for a company by this name.
const classifyWebsite = (name: string, website: string): WebsiteVerdict => {
	const host = hostOf(website)
	// An address we cannot even read the host of is left alone — nothing to judge.
	if (host === null) return 'keep'
	if (isAggregatorHost(host)) return 'directory'
	const core = nameCore(name)
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
	return 'keep'
}

export interface WebsiteGuardResult {
	/** The findings, with any directory or profile-page website removed. */
	readonly findings: unknown
	/** Websites blanked because their host is a known directory. */
	readonly blankedDirectory: number
	/** Websites blanked because the name sat in a deeper path of another host. */
	readonly blankedProfilePage: number
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
	let blankedDirectory = 0
	let blankedProfilePage = 0

	const count = (verdict: Exclude<WebsiteVerdict, 'keep'>): void => {
		if (verdict === 'directory') blankedDirectory++
		else blankedProfilePage++
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
			const verdict = classifyWebsite(targetName ?? '', value['value'])
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
			const verdict = classifyWebsite(name, website)
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

	return { findings: walk(findings), blankedDirectory, blankedProfilePage }
}
