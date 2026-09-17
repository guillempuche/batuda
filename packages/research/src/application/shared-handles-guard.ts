/**
 * Takes a social profile off the rows of a scan that did not earn it.
 *
 * A scan writes each company's profiles beside it, and a model reading two
 * companies off one stretch of evidence hands the second the first one's
 * Instagram. Nothing else in the chain can see it: the value is a real page on
 * a real platform, so it is grounded, and every value check asks whether a
 * value is in the evidence, not whose evidence it is in. The one thing that
 * tells the rows apart is whose own pages show the account: a company's site
 * links its own accounts, and a company whose site never mentions an account
 * two rows share has no claim on it.
 *
 * So a profile carried by more than one row stays only on a row whose own
 * site — a fetched page on the row's website host — shows it, and comes off
 * the rest. Two limits keep this from taking a real profile away: a profile
 * one row alone carries is left as it is, since there is nothing to settle;
 * and a shared profile no fetched page shows is left on every row, since the
 * run has no page to settle it with and the rightful owner would lose it too.
 */

import { isPlainObject, unwrapValue } from './guard-shapes'
import { siteHostOf } from './prospect-dedupe-guard'
import { socialProfileOf } from './social-sites'

export interface SharedHandlesResult {
	readonly findings: unknown
	/** Profiles taken off rows whose own pages never showed them. */
	readonly dropped: number
}

interface OpenedPage {
	readonly host?: string | undefined
	readonly text: string
}

const PROFILES_FIELD = 'social_profiles'

// What a profile is known by wherever it is written: the account's address on
// the platform, host and path, read the way a stored profile is — one spelling
// for the mobile host, the country's host, a trailing slash or a tracking
// parameter. Null for an address that is not an account page, which is left
// alone.
const accountOf = (profile: unknown): string | null => {
	if (!isPlainObject(profile)) return null
	const value = unwrapValue(profile['value'])
	if (typeof value !== 'string') return null
	const account = socialProfileOf(value)
	if (account === null) return null
	const address = account.value.replace(/^https:\/\//, '').toLowerCase()
	return address.includes('/') ? address : null
}

// Whether a page's text shows the account: the path as the platform writes it
// ("instagram.com/mefram_mecanitzats"), or the handle alone — a site as often
// writes "@mefram_mecanitzats" or the bare name beside the platform's icon.
// A page shows the account by its address ("instagram.com/mefram_mecanitzats")
// or by the bare handle beside the platform's icon ("@mefram_mecanitzats").
// The bare handle counts only when it is a word of its own and long enough
// not to be a word of the language: "acme" inside "acmeic" or on its own is
// nobody's account.
const HANDLE_MIN_CHARS = 5
const showsAccount = (text: string, account: string): boolean => {
	if (text.includes(account)) return true
	const handle = account.split('/').pop() ?? ''
	if (handle.length < HANDLE_MIN_CHARS) return false
	const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	return new RegExp(
		`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,
		'u',
	).test(text)
}

/**
 * `listField` is the key holding the scan's companies; anything else passes
 * through. `pages` are the pages the run opened, each with the host it sits on.
 */
export const dropSharedHandles = (
	findings: unknown,
	listField: string | undefined,
	pages: ReadonlyArray<OpenedPage>,
): SharedHandlesResult => {
	if (listField === undefined || !isPlainObject(findings))
		return { findings, dropped: 0 }
	const rows = findings[listField]
	if (!Array.isArray(rows)) return { findings, dropped: 0 }

	// How many rows carry each account, so one carried by a single row is left
	// alone.
	const rowsByAccount = new Map<string, number>()
	for (const row of rows) {
		if (!isPlainObject(row)) continue
		const profiles = row[PROFILES_FIELD]
		if (!Array.isArray(profiles)) continue
		const accounts = new Set(
			profiles.flatMap(profile => {
				const account = accountOf(profile)
				return account === null ? [] : [account]
			}),
		)
		for (const account of accounts)
			rowsByAccount.set(account, (rowsByAccount.get(account) ?? 0) + 1)
	}
	const shared = new Set(
		[...rowsByAccount].flatMap(([account, count]) =>
			count >= 2 ? [account] : [],
		),
	)
	if (shared.size === 0) return { findings, dropped: 0 }

	// The text of each host's pages, lower-cased once. Only the hosts the rows
	// stand on are worth keeping: those are the only pages ever asked.
	const hostsAsked = new Set(
		rows.flatMap(row => {
			const host = isPlainObject(row) ? siteHostOf(row) : null
			return host === null ? [] : [host]
		}),
	)
	const textByHost = new Map<string, Array<string>>()
	for (const page of pages) {
		if (page.host === undefined) continue
		const host = page.host.toLowerCase().replace(/^www\./, '')
		if (!hostsAsked.has(host)) continue
		const texts = textByHost.get(host) ?? []
		texts.push(page.text.toLowerCase())
		textByHost.set(host, texts)
	}
	const shownOn = (host: string | null, account: string): boolean =>
		host !== null &&
		(textByHost.get(host) ?? []).some(text => showsAccount(text, account))

	// A shared account is settled once the own pages of a row that carries it
	// show it; one no such page shows is left where it is.
	const carries = (row: unknown, account: string): boolean =>
		isPlainObject(row) &&
		Array.isArray(row[PROFILES_FIELD]) &&
		row[PROFILES_FIELD].some(profile => accountOf(profile) === account)
	const settled = new Set(
		[...shared].filter(account =>
			rows.some(
				row => carries(row, account) && shownOn(siteHostOf(row), account),
			),
		),
	)
	if (settled.size === 0) return { findings, dropped: 0 }

	let dropped = 0
	const kept = rows.map(row => {
		if (!isPlainObject(row)) return row
		const profiles = row[PROFILES_FIELD]
		if (!Array.isArray(profiles)) return row
		const host = siteHostOf(row)
		const earned = profiles.filter(profile => {
			const account = accountOf(profile)
			if (account === null || !settled.has(account)) return true
			const shown = shownOn(host, account)
			if (!shown) dropped++
			return shown
		})
		return earned.length === profiles.length
			? row
			: { ...row, [PROFILES_FIELD]: earned }
	})
	return dropped === 0
		? { findings, dropped: 0 }
		: { findings: { ...findings, [listField]: kept }, dropped }
}
