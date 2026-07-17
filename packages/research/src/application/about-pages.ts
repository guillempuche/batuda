/**
 * Picks a company's about / contact / team pages out of the links its homepage
 * already lists, so the run can fetch them deterministically instead of hoping the
 * model navigates there. Those pages carry the location and the named leaders a
 * homepage rarely spells out — and with own-host grounding, whatever they carry stays
 * in the evidence.
 *
 * Deliberately bounded and cheap: it reads links the homepage really has (so a guessed
 * path is never fetched into a 404), keeps only pages on the company's own site, and
 * returns at most `max`, preferring the pages that name people (a team/leadership page)
 * over a bare contact form.
 */

import { domainHost } from './entity-guard'

// Path fragments that mark a page worth fetching, in three bands by what it usually
// carries: people first (leaders and their titles), then the about/location pages,
// then a contact page as a last resort. Spans several languages so a non-English site
// is still covered.
const TEAM_HINTS = [
	'team',
	'leadership',
	'management',
	'people',
	'staff',
	'directors',
	'board',
	'equipo',
	'equipe',
	'leaders',
]
const ABOUT_HINTS = [
	'about',
	'company',
	'nosotros',
	'empresa',
	'quienes-somos',
	'qui-som',
	'chi-siamo',
	'a-propos',
	'ueber-uns',
	'uber-uns',
	'who-we-are',
	'impressum',
	'sobre',
]
const CONTACT_HINTS = ['contact', 'contacto', 'contacte', 'kontakt', 'contatti']

// Sections that use these same words in prose — "team-building" in a blog post, a
// press release naming a new hire — without being the company's own about page. A
// path under one of these is never a candidate, even when a hint appears in it.
const NON_PAGE_SEGMENTS = new Set([
	'blog',
	'news',
	'article',
	'articles',
	'post',
	'posts',
	'press',
	'category',
	'tag',
	'media',
])

// The lowercased path of a URL, or undefined when it doesn't parse.
const pathOf = (url: string): string | undefined => {
	try {
		return new URL(url).pathname.toLowerCase()
	} catch {
		return undefined
	}
}

// Which band a path falls in, or 3 (not a candidate) when no hint matches or it sits
// under a blog/news section.
const bandOf = (path: string): number => {
	if (path.split('/').some(segment => NON_PAGE_SEGMENTS.has(segment))) return 3
	if (TEAM_HINTS.some(hint => path.includes(hint))) return 0
	if (ABOUT_HINTS.some(hint => path.includes(hint))) return 1
	if (CONTACT_HINTS.some(hint => path.includes(hint))) return 2
	return 3
}

/**
 * Up to `max` about/contact/team URLs from `links`, on the same `host`, ranked so the
 * people pages come first. `host` is the homepage's own (redirect-resolved) host, in
 * the `www.`-stripped form `domainHost` returns.
 */
export const aboutPageCandidates = (
	links: ReadonlyArray<string>,
	host: string,
	max: number,
): ReadonlyArray<string> => {
	const seen = new Set<string>()
	const ranked: Array<{ url: string; band: number }> = []
	for (const link of links) {
		// Same company's own site only — a subdomain or a third party wouldn't ground
		// on the target's host and isn't what we're after here.
		if (domainHost(link) !== host) continue
		const path = pathOf(link)
		// Skip the homepage itself; it's already been fetched.
		if (path === undefined || path === '/' || path === '') continue
		const band = bandOf(path)
		if (band === 3) continue
		// Drop the fragment so "/team" and "/team#ceo" aren't both fetched.
		const url = link.split('#')[0] ?? link
		if (seen.has(url)) continue
		seen.add(url)
		ranked.push({ url, band })
	}
	ranked.sort((a, b) => a.band - b.band)
	return ranked.slice(0, max).map(entry => entry.url)
}
