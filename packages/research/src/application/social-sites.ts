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
