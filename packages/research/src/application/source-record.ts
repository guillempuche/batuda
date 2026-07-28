/**
 * Writes down, in `sources`, the pages a run has to show for its findings.
 *
 * A page reaches that record two ways, and the two are not the same thing: one
 * the run fetched and kept, whose text can be quoted back later, and one the run
 * only saw named somewhere, with nothing of it kept.
 *
 * Telling them apart is what keeps `last_fetched_at` honest. It says when the
 * page was really read, which is what decides whether the stored copy is still
 * current and how long it is worth keeping — so only a real read may move it.
 * Seeing a page named again says nothing about the copy on file.
 *
 * Neither call opens a transaction of its own; the caller already holds the one
 * that fits the work around it.
 */

import { Effect } from 'effect'
import type { SqlClient, SqlError } from 'effect/unstable/sql'

import { canonicalizeUrl, sourceIdFor, urlHashForScrape } from './source-key'

/** The site a URL belongs to, or `unknown` when the URL will not parse. */
const domainOf = (url: string): string => {
	try {
		return new URL(url).hostname.toLowerCase()
	} catch {
		return 'unknown'
	}
}

/** A page the run fetched and whose text it kept. */
export interface FetchedSource {
	/** The address the run asked for; the row stays keyed by this one. */
	readonly requestedUrl: string
	/** Where the request ended up, when a redirect took it to another site. */
	readonly resolvedUrl?: string | undefined
	readonly title?: string | undefined
	readonly language?: string | undefined
	/** Fingerprint of the text that was kept. */
	readonly contentHash: string
	/** Where the text is stored, or null when storing it did not work out. */
	readonly contentRef: string | null
	/** Who fetched it, so the trail can be read back later. */
	readonly provider: string
}

/** A page the run saw named somewhere, with none of it kept. */
export interface SeenSource {
	readonly url: string
	readonly title?: string | undefined
	/** Fingerprint of whatever text named the page, so the column is never empty. */
	readonly contentHash: string
	readonly provider: string
	/** A web page unless the run met it in an official register. */
	readonly kind?: 'web' | 'registry' | undefined
}

/**
 * Record a page the run fetched and kept.
 *
 * A fresh read is the best account of the page there is, so it overwrites where
 * the page lives, what its text says and where that text is stored, and moves
 * `last_fetched_at` to the moment the copy on file was made.
 */
export const recordFetchedSource = (
	sql: SqlClient.SqlClient,
	source: FetchedSource,
): Effect.Effect<void, SqlError.SqlError> => {
	const canonical = canonicalizeUrl(source.requestedUrl)
	const urlHash = urlHashForScrape(source.requestedUrl)
	// Keep the address the request landed on only when it left the original site
	// — a redirect within the same site is not worth rewriting the row for.
	const storedUrl =
		source.resolvedUrl !== undefined &&
		domainOf(source.resolvedUrl) !== domainOf(canonical)
			? source.resolvedUrl
			: canonical
	return sql`
		INSERT INTO sources (
			id, kind, provider, url, url_hash, domain,
			title, language, content_hash, content_ref,
			first_fetched_at, last_fetched_at
		) VALUES (
			${sourceIdFor(urlHash)}, 'web', ${source.provider}, ${storedUrl}, ${urlHash}, ${domainOf(storedUrl)},
			${source.title ?? null}, ${source.language ?? null},
			${source.contentHash}, ${source.contentRef},
			now(), now()
		)
		ON CONFLICT (url_hash) DO UPDATE SET
			last_fetched_at = now(),
			url             = EXCLUDED.url,
			domain          = EXCLUDED.domain,
			content_hash    = EXCLUDED.content_hash,
			content_ref     = EXCLUDED.content_ref,
			title           = COALESCE(EXCLUDED.title, sources.title),
			language        = COALESCE(EXCLUDED.language, sources.language)
	`
}

/**
 * Record a page the run only saw named.
 *
 * Writes a row the first time the page turns up and leaves an existing one
 * untouched. Standing back is the whole point: that row may already describe a
 * copy the run fetched, and a passing mention must not restate when that copy
 * was made, nor replace its fingerprint with one taken from a few lines of
 * search text.
 *
 * The row it writes points at no stored text, so whoever needs the page itself
 * still has to go and fetch it.
 */
export const recordSeenSource = (
	sql: SqlClient.SqlClient,
	source: SeenSource,
): Effect.Effect<void, SqlError.SqlError> => recordSeenSources(sql, [source])

/**
 * Record several pages the run only saw, in one statement.
 *
 * A search names ten pages at a time, and writing them one by one is ten trips
 * to the database for what one trip does. Same rule as the single form: an
 * existing row is left exactly as it stands.
 */
export const recordSeenSources = (
	sql: SqlClient.SqlClient,
	sources: ReadonlyArray<SeenSource>,
): Effect.Effect<void, SqlError.SqlError> => {
	// Nothing to say means no statement at all — an insert with no rows is a
	// syntax error, not an empty write.
	if (sources.length === 0) return Effect.void
	const rows = sources.map(source => {
		const canonical = canonicalizeUrl(source.url)
		const urlHash = urlHashForScrape(source.url)
		return {
			id: sourceIdFor(urlHash),
			kind: source.kind ?? 'web',
			provider: source.provider,
			url: canonical,
			urlHash,
			domain: domainOf(canonical),
			title: source.title ?? null,
			contentHash: source.contentHash,
		}
	})
	return sql`
		INSERT INTO sources ${sql.insert(rows)}
		ON CONFLICT (url_hash) DO NOTHING
	`
}
