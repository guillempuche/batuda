/**
 * Stops a source that cannot speak for the target company from populating its
 * fields.
 *
 * The run-level entity check asks "does the evidence, as a whole, concern the
 * target?" — but a single field is cited to a single URL, and the whole-corpus
 * verdict does not catch a field pulled from the wrong page. Two failures seen in
 * the field, both while the run reported a strong entity match:
 *  - a company head-count taken from a ZoomInfo **person** profile
 *    (`zoominfo.com/p/…`) about an unrelated individual;
 *  - three "executives" taken from an **Instagram reel** (`instagram.com/reel/…`)
 *    belonging to a different, much larger company.
 *
 * Two independent per-source checks close that gap:
 *
 * 1. **Structural namespace block**, from the URL alone:
 *    - **UGC / social-post** URLs (an Instagram reel, a TikTok video, an X
 *      status) can't establish a company fact OR a company contact — a post is
 *      not a record. Blocked everywhere.
 *    - **Person / people-search profiles** (ZoomInfo `/p/`, a Spokeo page, a
 *      LinkedIn `/in/` profile) can't establish a *company-level* firmographic,
 *      but a person's own profile is a fine source for *that contact's* role —
 *      so these are blocked only from the company firmographics, not from
 *      contacts.
 *
 * 2. **Right-company check on the cited page itself**: when the caller hands
 *    over the pages this run fetched, each company field's cited page is judged
 *    for the target company — host-aware, so an own-domain offices page that
 *    never spells the name still passes. A page that reads as a different
 *    company voids the field it sourced. A citation the run never fetched (a
 *    search snippet) keeps its field: this check removes only what it
 *    positively saw was wrong.
 *
 * A blocked company field is nulled (its neighbours stay); a contact whose only
 * tie to the company is a UGC post is dropped whole. A weakly-matched but
 * right-company page keeps its field — down-weighting weak sources is the
 * source-tier guard's job, not this one's.
 */

import type { EntityTargets } from './entity-guard'
import { classifyEntityMatchPerSource } from './entity-guard'
import { isPlainObject, isValueWrapper } from './guard-shapes'
import { hostOf, isWebAddress, pathOf } from './source-key'

type NamespaceTier = 'ugc' | 'profile' | null

// True when the host is `site` or a subdomain of it.
const hostMatches = (host: string, site: string): boolean =>
	host === site || host.endsWith(`.${site}`)

// A post published at the top of the site. The trailing boundary is the whole
// point: without it the word `photo` also begins `photography-studio-barcelona`,
// and `posts`, `watch` and `reel` likewise begin the names of real firms, so a
// company whose only citation was its own page read as a post and the row was
// dropped.
const FACEBOOK_POST_AT_ROOT =
	/^\/(?:reels?|watch|share|photo|posts|story\.php|permalink\.php|video\.php|photo\.php)(?:[/?]|$)/

// A post published on a page of its own — `/<page>/posts/<id>`, and the same for
// videos, photos and reels. This is how a page's own post is addressed, and
// nothing matched it before: a video posted by a radio station read as an
// ordinary page, so the check that exists to say "a post is not a record that a
// company exists" was never given it. An id has to follow, or the page's own
// listing tab (`/acme/videos/`) would be mistaken for a single post.
const FACEBOOK_POST_ON_A_PAGE =
	/^\/[^/]+\/(?:posts|videos|photos|reels)\/[^/?#]/

// Classify a source URL's namespace. `ugc` is a user-posted item (blocked for any
// field); `profile` is a person/people-search page (blocked for company fields
// only); null is an ordinary page, left alone here — the tier and entity guards
// judge it on its merits.
export const classifyNamespace = (sourceId: string): NamespaceTier => {
	// Only a real web address has a namespace to read: a bare word, or an internal
	// id for a page the run already holds, is nothing anybody posted.
	const host = isWebAddress(sourceId) ? hostOf(sourceId) : null
	if (host === null) return null
	const path = pathOf(sourceId) ?? ''

	// Social posts / short-form video — a post, not a record.
	// Read at the root and under a handle alike. Anchoring at the root alone is
	// what let a page's own post pass as an ordinary page on Facebook for months,
	// and Instagram addresses a post both ways too.
	if (
		hostMatches(host, 'instagram.com') &&
		(/^\/(?:reels?|p|tv)\//.test(path) ||
			/^\/[^/]+\/(?:reels?|p|tv)\/[^/?#]/.test(path))
	)
		return 'ugc'
	if (hostMatches(host, 'tiktok.com') && /\/video\//.test(path)) return 'ugc'
	if (hostMatches(host, 'youtube.com') && path.startsWith('/watch'))
		return 'ugc'
	if (hostMatches(host, 'youtu.be')) return 'ugc'
	// Serves nothing but posts, so its address alone settles it — the same reading
	// `youtu.be` gets above.
	if (hostMatches(host, 'fb.watch')) return 'ugc'
	// `fb.com` is the same site under a shorter name, so it reads by the same rules.
	if (
		(hostMatches(host, 'facebook.com') || hostMatches(host, 'fb.com')) &&
		(FACEBOOK_POST_AT_ROOT.test(path) || FACEBOOK_POST_ON_A_PAGE.test(path))
	)
		return 'ugc'
	if (
		(hostMatches(host, 'x.com') || hostMatches(host, 'twitter.com')) &&
		/\/status\//.test(path)
	)
		return 'ugc'
	if (hostMatches(host, 'threads.net')) return 'ugc'

	// Person / people-search profiles — about one person, not the company.
	if (hostMatches(host, 'zoominfo.com') && path.startsWith('/p/'))
		return 'profile'
	if (hostMatches(host, 'linkedin.com') && path.startsWith('/in/'))
		return 'profile'
	if (hostMatches(host, 'spokeo.com')) return 'profile'

	return null
}

const sourceIdOf = (value: unknown): string | undefined => {
	if (!isPlainObject(value)) return undefined
	const id = value['source_id']
	return typeof id === 'string' ? id : undefined
}

// Every source a contact leans on: its citation URLs plus the source of each of
// its sourced fields (role / email / phone).
const contactSourceIds = (contact: unknown): string[] => {
	if (!isPlainObject(contact)) return []
	const ids: string[] = []
	const citations = contact['citations']
	if (Array.isArray(citations)) {
		for (const citation of citations) {
			const id = sourceIdOf(citation)
			if (id !== undefined) ids.push(id)
		}
	}
	for (const key of ['role', 'email', 'phone']) {
		const id = sourceIdOf(contact[key])
		if (id !== undefined) ids.push(id)
	}
	return ids
}

/** The fetched page a citation URL resolves to — its text and its own host. */
export interface SourcePageMeta {
	readonly text: string
	readonly host?: string | undefined
}

/**
 * Resolves a citation URL to the page this run fetched for it, or undefined when
 * the URL was never fetched (a search snippet) — undefined always keeps the field.
 */
export type SourceMetaResolver = (
	sourceId: string,
) => SourcePageMeta | undefined

export interface EntitySourceResult {
	readonly findings: unknown
	/** Company firmographics nulled because their only source can't speak for the company. */
	readonly droppedCompanyFields: number
	/** Company firmographics nulled because their cited page reads as a different company. */
	readonly droppedOffEntity: number
	/** Contacts dropped because their only tie to the company was a user post. */
	readonly droppedContacts: number
	/** Contacts dropped for carrying no citation and no sourced role/email/phone. */
	readonly droppedUncited: number
}

/**
 * Apply both per-source checks to an enrichment result. Without `sourceMeta`
 * only the structural namespace block runs; with it, each company field's cited
 * page is also judged for the right company, and a citation that never resolves
 * to a fetched page keeps its field. Returns the result unchanged for a
 * non-object (e.g. an error blob).
 */
export const guardEntitySources = (
	findings: unknown,
	targets: EntityTargets,
	sourceMeta?: SourceMetaResolver,
): EntitySourceResult => {
	if (!isPlainObject(findings))
		return {
			findings,
			droppedCompanyFields: 0,
			droppedOffEntity: 0,
			droppedContacts: 0,
			droppedUncited: 0,
		}

	// True only when the cited page was fetched this run AND reads as a different
	// company. Host-aware: the company's own page passes on its host alone.
	const isOffEntityPage = (sourceId: string): boolean => {
		const meta = sourceMeta?.(sourceId)
		if (meta === undefined) return false
		const [verdict] = classifyEntityMatchPerSource(targets, [
			{ sourceId, text: meta.text, host: meta.host },
		])
		return verdict?.match === 'absent'
	}

	let droppedCompanyFields = 0
	let droppedOffEntity = 0
	let droppedContacts = 0
	let droppedUncited = 0
	const out: Record<string, unknown> = { ...findings }

	// Company firmographics: null any field whose source is a blocked namespace
	// (a company fact must not come from a post or a person page), then any whose
	// cited page turned out to be about a different company.
	const enrichment = out['enrichment']
	if (isPlainObject(enrichment)) {
		const guarded: Record<string, unknown> = { ...enrichment }
		for (const [key, value] of Object.entries(guarded)) {
			if (!isValueWrapper(value)) continue
			const id = sourceIdOf(value)
			if (id === undefined) continue
			if (classifyNamespace(id) !== null) {
				guarded[key] = null
				droppedCompanyFields++
			} else if (isOffEntityPage(id)) {
				guarded[key] = null
				droppedOffEntity++
			}
		}
		out['enrichment'] = guarded
	}

	// Contacts: drop a person whose only tie to the company is a user post, or who
	// carries no provenance at all (a bare name with no citation and no sourced
	// role/email/phone — unsafe to treat as a lead). A person's own professional
	// profile (a `profile` namespace) is left in place — it is a fine source for
	// that contact's role.
	const contacts = out['contacts']
	if (Array.isArray(contacts)) {
		out['contacts'] = contacts.filter(contact => {
			const ids = contactSourceIds(contact)
			if (ids.length === 0) {
				droppedUncited++
				return false
			}
			// Every tie, not any one of them: a person the company also names on its
			// own team page is a real contact whom a post happens to mention too, and
			// the post is not what we are leaning on.
			if (ids.every(id => classifyNamespace(id) === 'ugc')) {
				droppedContacts++
				return false
			}
			return true
		})
	}

	return {
		findings: out,
		droppedCompanyFields,
		droppedOffEntity,
		droppedContacts,
		droppedUncited,
	}
}
