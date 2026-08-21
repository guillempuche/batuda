/**
 * Keeps a company's social page when it was offered as its website.
 *
 * A small firm often has no site of its own, and the only web presence a run can
 * find for it is its page on a platform. Asked for a website, the run hands that
 * page back. The website check refuses it, rightly — whoever clicks a website
 * expects the company's own site, not Facebook — and a refused address is
 * dropped, which would throw away the one way anybody had found of reaching that
 * company.
 *
 * So the address is moved rather than dropped: off the website field, and onto
 * the row as what it actually is, a page on a platform. The company ends up with
 * no website and a Facebook page, which is the truth about it.
 *
 * ## Why this runs before the website check, and not inside it
 *
 * `website-guard.ts` only ever takes a value away. Every rule it holds is
 * written as a reason to blank, its counts are counts of blanks, and a caller
 * reading it knows that what comes back is what went in with things missing.
 * A rule that also WROTE somewhere else would quietly end that, and the next
 * person to reason about the guard would be wrong with nothing to warn them.
 *
 * Running first also puts the two in the right order for a plainer reason: once
 * this has moved the address, that field is empty and there is nothing left for
 * the check to condemn. What it does condemn is then what nothing could rescue,
 * which is what its count should mean.
 *
 * ## What is moved, and what is still dropped
 *
 * Only a page a company opened in its own name. `socialProfileOf` in
 * `social-sites.ts` decides that — it refuses a post, a video, a share link that
 * spells nothing, a group and one person's own profile, and sets out why. What
 * it refuses is left exactly where it stands, for the website check that follows
 * to condemn as it always would.
 *
 * ## The pages a run reports itself
 *
 * A run can also name a company's pages outright, without going near the website
 * field, and those are put through the same reading. Two reasons, and the first
 * is the one that bites: an address becomes a stored way of reaching the company,
 * so one page written two ways ("m.facebook.com/acme/?ref=share" one round,
 * "facebook.com/acme" the next) would be stored as two, and the company would be
 * listed as having two Facebooks. Reading each one back into a single spelling
 * ends that wherever the page came from.
 *
 * The second is that a run naming a post as a company's Facebook is as wrong as
 * a run offering one as its website, so it is dropped the same way.
 *
 * What the reading does NOT recognise is kept exactly as it arrived. The field is
 * open on purpose — a platform nobody has met yet needs no change here — and
 * refusing an address for being unfamiliar would throw away the very thing that
 * openness is for.
 */

import { isPlainObject } from './guard-shapes'
import {
	isSocialPlatformHost,
	type SocialProfile,
	socialProfileOf,
} from './social-sites'
import { hostOf } from './source-key'

// Subtrees copied through whole: a citation and a proposed update carry their
// own `name` — a person's, on a contact proposal — and a page found under one of
// those belongs to that person, not to the company the row is about.
const SKIP_KEYS = new Set(['citations', 'proposed_updates'])

// Where a run reports the pages a company keeps on platforms. One name across
// every answer that has the field, so the walk below need not know which kind of
// answer it is reading.
const PROFILES_KEY = 'social_profiles'

// Whether this row already reports the page, so a rescue run twice over one
// answer does not record it twice. A run reads its list several times and folds
// the readings together, which is exactly when the same page arrives again.
const alreadyReported = (
	existing: ReadonlyArray<SocialProfile>,
	profile: SocialProfile,
): boolean =>
	existing.some(
		entry => entry.value === profile.value && entry.kind === profile.kind,
	)

// The pages a run named itself, each read back into one spelling. An entry this
// reading recognises is kept as the single address that page has; one it
// recognises as belonging to a platform but NOT as anybody's page — a post, a
// share link — is dropped, since it is no more the company's page here than it
// would be in the website field; and one on a host it does not know at all is
// kept as it arrived, because the field is open on purpose.
const profilesAsReported = (held: unknown): ReadonlyArray<SocialProfile> => {
	if (!Array.isArray(held)) return []
	const profiles: Array<SocialProfile> = []
	for (const entry of held) {
		if (!isPlainObject(entry)) continue
		const kind = entry['kind']
		const value = entry['value']
		if (typeof kind !== 'string' || typeof value !== 'string') continue
		const read = socialProfileOf(value)
		if (read !== null) {
			if (!alreadyReported(profiles, read)) profiles.push(read)
			continue
		}
		if (isSocialPlatformHost(hostOf(value) ?? '')) continue
		const asGiven = { kind, value }
		if (!alreadyReported(profiles, asGiven)) profiles.push(asGiven)
	}
	return profiles
}

const withProfile = (
	row: Record<string, unknown>,
	profile: SocialProfile,
): Record<string, unknown> => {
	const held = profilesAsReported(row[PROFILES_KEY])
	return {
		...row,
		[PROFILES_KEY]: alreadyReported(held, profile) ? held : [...held, profile],
	}
}

export interface SocialWebsiteRescueResult {
	/** The findings, with each rescued page moved off the website field. */
	readonly findings: unknown
	/** Pages moved onto their company as a way of reaching it. */
	readonly rescued: number
}

/**
 * Move every social page offered as a company's website onto that company.
 *
 * Which company the page belongs to is not in question: the address arrived
 * claimed as this row's own website, and this only disagrees about what KIND of
 * address it is. So no name is needed and none is read.
 */
export const rescueSocialWebsites = (
	findings: unknown,
): SocialWebsiteRescueResult => {
	let rescued = 0

	const walkChild = (key: string, value: unknown): unknown =>
		SKIP_KEYS.has(key) ? value : walk(value, key)

	function walk(value: unknown, key?: string): unknown {
		if (Array.isArray(value)) return value.map(item => walk(item))
		if (!isPlainObject(value)) return value

		const website = value['website']

		// A scanned company: its name and the website the run gave for it, side by
		// side. The key goes with the page, so the row reads as one the model never
		// gave a website for — the same as any other field a guard removes.
		if (
			key !== 'website' &&
			typeof website === 'string' &&
			typeof value['name'] === 'string'
		) {
			const profile = socialProfileOf(website)
			if (profile !== null) {
				rescued++
				const { website: _moved, ...rest } = value
				return Object.fromEntries(
					Object.entries(withProfile(rest, profile)).map(
						([k, v]) => [k, walkChild(k, v)] as const,
					),
				)
			}
		}

		// The run's own answer for the company it was asked about: the website
		// arrives wrapped with the page it was read from and no name beside it.
		// Emptied where it stands rather than removed, because a reader of the
		// profile still needs to see the field was asked for.
		if (
			isPlainObject(website) &&
			typeof website['value'] === 'string' &&
			typeof website['name'] !== 'string'
		) {
			const profile = socialProfileOf(website['value'])
			if (profile !== null) {
				rescued++
				const emptied = { ...value, website: null }
				return Object.fromEntries(
					Object.entries(withProfile(emptied, profile)).map(
						([k, v]) => [k, walkChild(k, v)] as const,
					),
				)
			}
		}

		// A row that named its pages itself and had no social website to move. The
		// same reading still applies, so one page reported two ways is stored once.
		const tidied = Object.hasOwn(value, PROFILES_KEY)
			? { ...value, [PROFILES_KEY]: profilesAsReported(value[PROFILES_KEY]) }
			: value

		return Object.fromEntries(
			Object.entries(tidied).map(([k, v]) => [k, walkChild(k, v)] as const),
		)
	}

	return { findings: walk(findings), rescued }
}
