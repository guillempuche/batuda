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

import { DISTINCTIVE_NAME_LENGTH, domainHost } from './entity-guard'
import { pathOf } from './source-key'

// Path fragments that mark a page worth fetching, in three bands by what it usually
// carries: people first (leaders and their titles), then the about/location pages,
// then a contact page as a last resort. Spans several languages so a non-English site
// is still covered.
//
// Matched as substrings, so a word that is the front of another covers both:
// 'equip' catches the Catalan /equip and the Spanish /equipo and the French
// /equipe at once. It is listed rather than left to 'equipo' because the shorter
// spelling is the one a Catalan site uses — egein.com/ca/equip lists forty-two
// people with their titles, and without it that page fell to the about band and
// lost to a contact form.
const TEAM_HINTS = [
	'team',
	'leadership',
	'management',
	'people',
	'staff',
	'directors',
	'board',
	'equip',
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
	'actualitat',
	'actualidad',
	'noticies',
	'noticias',
	'portfolio',
	'projectes',
	'proyectos',
	'article',
	'articles',
	'post',
	'posts',
	'press',
	'category',
	'tag',
	'media',
])

// Whether any word of a segment is one of these. Split rather than compared whole,
// because a section is written as a phrase as often as a word — "actualitat-i-
// noticies" is the news, and matching the segment exactly let a press release
// through as a page that would name the staff, then spent a fetch on it.
const segmentNames = (segment: string, words: ReadonlySet<string>): boolean =>
	segment.split(/[^a-z0-9]+/).some(word => word !== '' && words.has(word))

// A page the company named after itself. Every word long enough to carry a name
// has to be one of the company's own, so "/ca/er-enginy" is ER Enginy talking
// about itself while "/referencies/nau-industrial-a-girona" is a project of its
// own that happens to sit on the same site. Short words are passed over, because
// a name breaks into them — "er" in ER Enginy, "de" in anything Spanish.
const namedAfterTheCompany = (
	path: string,
	ownWords: ReadonlySet<string>,
): boolean => {
	if (ownWords.size === 0) return false
	return path
		.split('/')
		.filter(Boolean)
		.some(segment => {
			const words = segment
				.split(/[^a-z0-9]+/)
				.filter(word => word.length >= DISTINCTIVE_NAME_LENGTH)
			return words.length > 0 && words.every(word => ownWords.has(word))
		})
}

// Which band a path falls in, or 3 (not a candidate) when no hint matches or it sits
// in a section that only ever talks about other things.
const bandOf = (path: string, ownWords: ReadonlySet<string>): number => {
	if (path.split('/').some(segment => segmentNames(segment, NON_PAGE_SEGMENTS)))
		return 3
	if (TEAM_HINTS.some(hint => path.includes(hint))) return 0
	if (ABOUT_HINTS.some(hint => path.includes(hint))) return 1
	if (namedAfterTheCompany(path, ownWords)) return 1
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
	options: {
		/**
		 * The weakest kind of page worth taking: 0 a team page, 1 an about page, 2
		 * a contact page. A caller filling in a company's location takes all three,
		 * because an address is on a contact page as often as anywhere. A caller
		 * after the company's PEOPLE stops at 1 — a contact form names a
		 * switchboard, and fetching one to look for staff spends the money and
		 * returns nobody.
		 */
		readonly weakestBand?: number
		/**
		 * The company's own distinctive words, when the caller knows them. A small
		 * firm often names its about page after itself rather than "about" or
		 * "nosaltres" — erenginy.com puts it at /ca/er-enginy — and no list of
		 * words in any language will ever catch that.
		 */
		readonly ownWords?: ReadonlyArray<string>
	} = {},
): ReadonlyArray<string> => {
	const weakestBand = options.weakestBand ?? 2
	const ownWords = new Set(options.ownWords ?? [])
	const seen = new Set<string>()
	const ranked: Array<{ url: string; band: number }> = []
	for (const link of links) {
		// Same company's own site only — a subdomain or a third party wouldn't ground
		// on the target's host and isn't what we're after here.
		if (domainHost(link) !== host) continue
		const path = pathOf(link)
		// Skip the homepage itself; it's already been fetched. (pathOf returns
		// null on an unparseable URL, and '/' for a bare host.)
		if (path === null || path === '/') continue
		const band = bandOf(path, ownWords)
		if (band > weakestBand) continue
		// Drop the fragment so "/team" and "/team#ceo" aren't both fetched.
		const url = link.split('#')[0] ?? link
		if (seen.has(url)) continue
		seen.add(url)
		ranked.push({ url, band })
	}
	ranked.sort((a, b) => a.band - b.band)
	return ranked.slice(0, max).map(entry => entry.url)
}
