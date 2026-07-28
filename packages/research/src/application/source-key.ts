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

/**
 * The `www.`-stripped, lowercased host of a URL, or null if it doesn't parse — for
 * comparing two URLs by the SITE they belong to rather than the exact page.
 */
export const hostOf = (url: string): string | null => {
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
	} catch {
		// A scheme-less "monzo.com" or "www.acme.es/x" — the tidied form a model
		// often emits — throws above; retry with a scheme so it still resolves.
		try {
			return new URL(`https://${url}`).hostname
				.toLowerCase()
				.replace(/^www\./, '')
		} catch {
			return null
		}
	}
}

/**
 * The lowercased path of a URL (always starting with "/"), or null if it doesn't
 * parse — for telling apart namespaces on one host, e.g. LinkedIn's `/in/` (a
 * person) from `/company/`, or ZoomInfo's `/p/` (a person) from a company record.
 */
export const pathOf = (url: string): string | null => {
	try {
		return new URL(url).pathname.toLowerCase()
	} catch {
		try {
			return new URL(`https://${url}`).pathname.toLowerCase()
		} catch {
			return null
		}
	}
}
