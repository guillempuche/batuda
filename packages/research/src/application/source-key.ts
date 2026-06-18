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
