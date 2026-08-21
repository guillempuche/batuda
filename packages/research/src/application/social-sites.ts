/**
 * Whether a host is a social platform — a site that publishes pages FOR
 * companies rather than BY them.
 *
 * A small firm often has no website at all. Asked for "the company's own
 * official website", a run hands back the only web presence it could find, and
 * that is the company's Facebook page. The answer is helpful and it is wrong:
 * whoever clicks it lands on Facebook.
 *
 * Read as an address, "facebook.com/LIPOTECH.SARL" and
 * "xpo.com/about-xpo-logistics" are the SAME SHAPE — a first-segment page naming
 * the company on a host that does not — and `website-guard.ts` has to keep the
 * second, because a company describing itself on its own site is exactly what
 * that exemption protects. What separates them is what the host IS, which is the
 * one thing an address cannot say and the one thing this file answers.
 *
 * ## Why a fixed list here, when `directory-sites.ts` refuses one
 *
 * That file's argument is that no list can name the business directories: every
 * country has its own, so the ones a Spanish search meets are not the ones a
 * French one does, and a list written in one market is blind in the next. It is
 * right, and none of it carries over.
 *
 * **The set is bounded, and it is the same set everywhere.** A country can
 * always add another register, another chamber, another yellow pages, and does.
 * The platforms are a handful, and it is the same handful in Girona as in
 * Toulouse.
 *
 * **Behaviour cannot answer this.** The watch next door works because a listing
 * DOES something a run can see: it files more than one of the run's own
 * companies at pages naming them. A platform holding one company's page behaves
 * exactly like that company's own site, so the evidence that makes that watch
 * possible is missing here — and the open-endedness that makes a list unsafe
 * there is missing here.
 *
 * None of that licenses a hand-written list of directories: what carries the
 * argument is a set fixed and known before any run starts, and a directory list
 * is never that.
 *
 * The list names platforms, not every address that reaches one. No run has yet
 * handed back a shortened link ("fb.com", "lnkd.in") as a company's website, so
 * none is listed; add one when a run offers one.
 *
 * The hosts are the ones `entity-source-guard.ts` already names, LinkedIn added.
 * That file asks a narrower question of the same platforms — whether a SOURCE is
 * a post rather than a record — so it reads the path and lets a company's
 * LinkedIn page stand as a citation, which is right: a page can be worth reading
 * and still not be the company's website.
 *
 * ## What it costs, on purpose
 *
 * A platform loses its own website: asked about LinkedIn or about TikTok, this
 * blanks the one address that really is the site.
 *
 * Paid rather than exempted, because the exemption was measured and it is the
 * costlier of the two ways to be wrong. Exempting means reading who owns the
 * host, and ownership is granted by any distinctive word of a name — so
 * "Instagram Marketing SL" owns instagram.com by that reading, and "Facebook Ads
 * Agency" owns facebook.com. Agencies named after the platform they work on are
 * ordinary; platforms among these markets' installers and carriers are not.
 */

import { hostOf, isBareWebAddress } from './source-key'

// Matched on the host alone, whatever path follows: a profile, a post and the
// home page alike are somebody's account rather than a company's own site.
const SOCIAL_PLATFORMS = [
	'facebook.com',
	'instagram.com',
	'linkedin.com',
	'x.com',
	'twitter.com',
	'tiktok.com',
	'youtube.com',
	'youtu.be',
	'threads.net',
] as const

/**
 * Whether this host is a social platform.
 *
 * A subdomain counts, since the platforms serve their own countries and their
 * own devices from one ("es-la.facebook.com", "m.facebook.com"). A host that
 * merely ends in the same letters does not: "notfacebook.com" and
 * "facebook-ads-agency.com" are ordinary sites belonging to whoever registered
 * them.
 *
 * Capitals, stray spaces and the dot a domain may end in are all read through: a
 * domain means the same however it was typed, and one that slipped past would
 * ship the page this exists to stop. The trailing dot matters most — an address
 * carrying one is still fetchable, and still spells Facebook.
 */
export const isSocialPlatformHost = (host: string): boolean => {
	const tidied = host.trim().toLowerCase().replace(/\.$/, '')
	return SOCIAL_PLATFORMS.some(
		platform => tidied === platform || tidied.endsWith(`.${platform}`),
	)
}

/**
 * A way of reaching a company on a platform: which platform, and the address.
 *
 * The address is not the company's website — that is what the check above
 * settles — but its page on a platform is still worth keeping, the way its
 * telephone number is.
 */
export interface SocialProfile {
	/** The platform, as a channel is stored under: "facebook", "linkedin", … */
	readonly kind: string
	/** The address as it was given. */
	readonly value: string
}

// Which platform a host belongs to, under the name a channel is stored by. The
// two names Twitter answers to are one platform and one channel.
const KIND_BY_HOST: ReadonlyArray<readonly [string, string]> = [
	['facebook.com', 'facebook'],
	['instagram.com', 'instagram'],
	['linkedin.com', 'linkedin'],
	['x.com', 'x'],
	['twitter.com', 'x'],
	['tiktok.com', 'tiktok'],
	['youtube.com', 'youtube'],
	['threads.net', 'threads'],
]

// The words each platform has taken for itself, so an address starting with one
// names no account. A refusal list rather than a list of the names allowed,
// because what a company may call itself is unbounded while what the platform
// has taken is not.
const RESERVED: Record<string, ReadonlySet<string>> = {
	facebook: new Set([
		'groups',
		'share',
		'sharer.php',
		'watch',
		'reel',
		'story.php',
		'permalink.php',
		'profile.php',
		'photo',
		'photo.php',
		'media',
		'events',
		'marketplace',
		'hashtag',
		'search',
		'pages',
		'p',
		'login',
		'help',
		'policies',
	]),
	instagram: new Set([
		'p',
		'reel',
		'reels',
		'explore',
		'stories',
		'tv',
		'accounts',
		'direct',
	]),
	x: new Set([
		'i',
		'home',
		'search',
		'explore',
		'hashtag',
		'intent',
		'share',
		'status',
		'notifications',
		'messages',
		'settings',
	]),
}

// The path with its capitals left on. `pathOf` folds a path to lowercase, which
// is what comparing a segment against a word a platform reserved wants and the
// opposite of what the address itself wants: a YouTube channel is filed under an
// id where the capitals count, so a lowercased one links to nothing.
const pathAsWritten = (url: string): string => {
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url)
		? url
		: `https://${url}`
	try {
		return new URL(withScheme).pathname
	} catch {
		return ''
	}
}

/**
 * The company's own page on a platform, or null when the address is not one.
 *
 * A page a company opened in its own name is a way of reaching it. A post inside
 * somebody's group, a video, a share link that spells nothing, a person's own
 * profile — none of those is, and recording one as "the company's Facebook"
 * writes down something that was never true. So each platform is read for the
 * shape its ACCOUNT pages take, and everything else is refused.
 *
 * The refusals are the point, and the two addresses a market search actually
 * offered are both among them: "facebook.com/share/1CtPJpK3i7/" says only that
 * somebody pressed share, and "instagram.com/p/DTxItU0lfKN/" is one post, which
 * belongs to an account this address does not name. Neither becomes a channel.
 *
 * Refusing a real page costs a way of reaching the company that nobody had a
 * minute ago, and anybody who looks can put it back. Accepting one that is not
 * the company's puts a stranger's page on the row under the company's own name,
 * where the next person to read it has no reason to doubt it. So an address that
 * does not plainly take the shape of an account is refused.
 */
export const socialProfileOf = (url: string): SocialProfile | null => {
	const host = hostOf(url)
	if (host === null || !isBareWebAddress(url)) return null
	const tidied = host.trim().toLowerCase().replace(/\.$/, '')
	const matched = KIND_BY_HOST.find(
		([site]) => tidied === site || tidied.endsWith(`.${site}`),
	)
	if (matched === undefined) return null
	const [site, kind] = matched

	const segments = pathAsWritten(url)
		.split('/')
		.filter(Boolean)
		.map(segment => segment.trim())
	const written = segments[0]
	if (written === undefined) return null
	// Compared in one case, kept in the other: which word a platform reserved is
	// not a question about capitals, while the address itself is.
	const first = written.toLowerCase()

	// The answer if the address does turn out to take the shape of an account.
	//
	// Written back from what was read rather than kept as it arrived, because this
	// becomes a stored way of reaching the company and two spellings of one page
	// would be stored as two — a company listed as having two Facebooks. So the
	// platform's own host stands in for whichever door the address came through
	// (the mobile one, a country's), the trailing slash goes, and so do the
	// tracking parameters a shared link picks up: a page is the same page whichever
	// link reached it.
	const profile = {
		kind,
		value: `https://${site}/${segments.join('/')}`,
	}

	// A company keeps its page under "company" or "showcase"; "in" is one person,
	// and a person is not the company however senior they are.
	if (kind === 'linkedin')
		return segments.length === 2 &&
			(first === 'company' || first === 'showcase')
			? profile
			: null

	// The handle platforms write an account as "@name" and everything else under a
	// word of their own, so the mark IS the tell and no refusal list is needed.
	if (kind === 'tiktok' || kind === 'threads')
		return segments.length === 1 && first.startsWith('@') ? profile : null

	// A channel is written four ways here, one of them the same "@name" the others
	// use, and the rest a word of YouTube's own followed by the name.
	if (kind === 'youtube') {
		if (segments.length === 1 && first.startsWith('@')) return profile
		return segments.length === 2 &&
			(first === 'c' || first === 'channel' || first === 'user')
			? profile
			: null
	}

	// The rest put an account at the top level, so one segment that the platform
	// has not reserved is the account's own name. A platform read this way with no
	// list of its own words yet would take every address as an account, so it is
	// refused until somebody writes the list — the direction this file is allowed
	// to be wrong in.
	const reserved = RESERVED[kind]
	if (reserved === undefined) return null
	return segments.length === 1 && !reserved.has(first) ? profile : null
}
