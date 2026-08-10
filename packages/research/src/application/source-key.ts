/**
 * Content-addressing key for scraped sources. Single source of truth shared by
 * the sources cache (which upserts a row per URL) and the run-attribution path
 * (which links a run to those rows) so the two can never drift on how a URL
 * maps to its `sources.url_hash`.
 */

import { createHash } from 'node:crypto'

/**
 * Canonicalize a URL before hashing: lowercase host, drop the fragment, trim a
 * trailing slash. Minimal on purpose — enough to collapse obvious repeats
 * within a research run.
 */
export const canonicalizeUrl = (url: string): string => {
	try {
		const u = new URL(url)
		u.hostname = u.hostname.toLowerCase()
		u.hash = ''
		if (u.pathname.endsWith('/') && u.pathname !== '/') {
			u.pathname = u.pathname.slice(0, -1)
		}
		return u.toString()
	} catch {
		return url
	}
}

/** The `sources.url_hash` a scraped URL maps to — the natural key a run links by. */
export const urlHashForScrape = (url: string): string =>
	createHash('sha256').update(canonicalizeUrl(url)).digest('hex')

/**
 * The `sources.id` a URL maps to — built from the same hash the row is keyed by,
 * so a page lands on one row however the run met it.
 */
export const sourceIdFor = (urlHash: string): string =>
	`src_${urlHash.slice(0, 16)}`

// Parse a URL, retrying with a scheme glued on the front — a scheme-less
// "monzo.com" or "www.acme.es/x", the tidied form a model often emits, throws on
// the first attempt. Null when neither form parses.
const parseUrl = (url: string): URL | null => {
	try {
		return new URL(url)
	} catch {
		try {
			return new URL(`https://${url}`)
		} catch {
			return null
		}
	}
}

/**
 * The `www.`-stripped, lowercased host of a URL, or null if it doesn't parse — for
 * comparing two URLs by the SITE they belong to rather than the exact page.
 */
export const hostOf = (url: string): string | null => {
	const parsed = parseUrl(url)
	return parsed === null
		? null
		: parsed.hostname.toLowerCase().replace(/^www\./, '')
}

/**
 * The lowercased path of a URL (always starting with "/"), or null if it doesn't
 * parse — for telling apart namespaces on one host, e.g. LinkedIn's `/in/` (a
 * person) from `/company/`, or ZoomInfo's `/p/` (a person) from a company record.
 */
export const pathOf = (url: string): string | null => {
	const parsed = parseUrl(url)
	return parsed === null ? null : parsed.pathname.toLowerCase()
}

// A host that is really a domain name: dot-separated labels ending in a top-level one
// of letters, or the `xn--` form the parser turns a non-Latin ending like `.рф` into.
// Rules out the bare words the scheme retry above happily accepts, and the numeric
// hosts nobody cites. Deliberately generous about what a label may hold, because
// saying "not an address" about a real site is the costlier mistake: it would let a
// third party's page skip the confidence cap.
const DOMAIN_NAME =
	/^(?:[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+)$/

/**
 * Whether a string is an address that could actually be fetched off the web.
 *
 * Ask this — not `hostOf(x) !== null` — whenever the question is "is this a web
 * address?". `hostOf` answers with a host for any bare word, so an internal
 * `src_…` id for a page already stored reads as the site "src_…": a run pays to
 * fetch it, and it never matches the company's own domain.
 */
export const isWebAddress = (value: string): boolean => {
	const parsed = parseUrl(value)
	if (parsed === null) return false
	// Only what a browser or a scraper could open, and never a mailbox: an
	// "info@acme.es" would otherwise parse as the site acme.es.
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
	if (parsed.username !== '' || parsed.password !== '') return false
	// A trailing dot spells the same domain, so it is no reason to call a real site
	// unreadable.
	return DOMAIN_NAME.test(parsed.hostname.toLowerCase().replace(/\.$/, ''))
}
