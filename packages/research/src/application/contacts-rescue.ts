/**
 * A focused second extraction that recovers a company's people when the broad
 * pass under-delivered.
 *
 * The single broad `generateObject` fills the whole schema at once and reliably
 * drops the contacts list — the evidence names the leaders, but the model's
 * attention is spread across every other field and it returns one contact or none,
 * or a handful of names with no titles. This runs a narrow pass that does nothing
 * but pull named people and their titles, then folds them into the broad findings.
 * It fires when the broad pass found at most one contact, OR when any contact it
 * did find has no title, so a run that already has its people with titles pays
 * nothing.
 *
 * The recovered contacts flow through the same guard chain as the broad ones
 * (citations, per-contact entity binding, source tier), so nothing here ships
 * unguarded — this module only defines the focused schema, its prompt, the merge,
 * and the "should we bother" test; the run wires them into the guard chain.
 */

import { Schema } from 'effect'

import { hasTitle } from './extraction-fill'
import { Citation, Sourced } from './schemas/_shared'

// The narrow schema the focused pass fills: people only, each with a title and the
// source(s) that name them as this company's own staff. Citations are required
// here (unlike the optional field on the broad schema) so a recovered contact is
// never added without provenance to bind it to the target.
const RescueContact = Schema.Struct({
	name: Schema.String,
	role: Schema.optionalKey(Sourced(Schema.String)),
	citations: Schema.Array(Citation),
})

export const ContactsRescueSchema = Schema.Struct({
	contacts: Schema.Array(RescueContact),
})

// Below this many contacts, the broad pass is treated as having under-delivered and
// the focused pass runs. One-or-none is the signal a company that publishes a team
// still came back essentially empty.
const RESCUE_BELOW_CONTACTS = 2

const contactsOf = (findings: unknown): ReadonlyArray<unknown> => {
	if (findings === null || typeof findings !== 'object') return []
	const contacts = (findings as { contacts?: unknown }).contacts
	return Array.isArray(contacts) ? contacts : []
}

const isNamed = (contact: unknown): boolean =>
	contact !== null &&
	typeof contact === 'object' &&
	typeof (contact as { name?: unknown }).name === 'string' &&
	(contact as { name: string }).name.trim() !== ''

/**
 * Whether the broad findings are thin enough on people to justify a focused pass:
 * fewer than a team's worth of named people, or any named person returned without a
 * title. A titleless contact is as much a miss as a missing one — the whole point is
 * a decision-maker the CRM can act on — and the focused pass recovers the title the
 * broad pass left off.
 */
export const needsContactRescue = (findings: unknown): boolean => {
	const named = contactsOf(findings).filter(isNamed)
	return named.length < RESCUE_BELOW_CONTACTS || named.some(c => !hasTitle(c))
}

export interface ContactsRescueTarget {
	readonly name: string
	readonly domain?: string | undefined
}

/**
 * The focused-pass prompt: people and titles only, bound to the target, verbatim.
 *
 * `sourceManifest` is the run's fetched source URLs, one per line. Handing them to
 * the model and asking it to copy one back keeps a recovered person's citation to a
 * URL the run actually fetched — otherwise the model tends to tidy the URL, and the
 * citation guard, matching against the fetched pages, drops the whole title with it.
 */
export const contactsRescuePrompt = (
	target: ContactsRescueTarget,
	evidence: string,
	sourceManifest?: string,
): string => {
	const citationRule =
		sourceManifest && sourceManifest.trim().length > 0
			? `For each person's title and citations, use one of these exact fetched source URLs, copied verbatim:\n\n${sourceManifest}`
			: "For each person's title and citations, use the exact source URL it came from, copied verbatim."
	return [
		`From the evidence below, list EVERY named person who is a leader or employee of "${target.name}"${
			target.domain ? ` (official site ${target.domain})` : ''
		}, with their exact job title.`,
		"For each person return: their full name as written; `role` — their exact title with the source URL and a verbatim quote stating the name and title; and `citations` — the source URL(s) where they appear as this company's own person, each with a verbatim quote.",
		'Rules:',
		`- Only ${target.name}'s OWN leaders or staff. IGNORE anyone described as a client, customer, partner, vendor, or testimonial, and anyone who works for a DIFFERENT company — even when they are quoted on this company's own site.`,
		'- Distinguish current leaders from founders: someone who "co-founded" the company is a founder; give a current role only if the evidence says they still hold it.',
		'- Copy names and titles verbatim from the evidence; never invent a person, a title, or a source.',
		citationRule,
		'',
		'Evidence:',
		evidence,
	].join('\n')
}

// A person's name reduced to a comparison key: lowercased, accent-folded, stripped
// of punctuation and collapsed whitespace. Deliberately exact (no initials/nickname
// matching) so two genuinely different spellings stay separate rather than risk
// merging two different people — recall over a lossy merge.
export const normalizeContactName = (name: string): string =>
	name
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()

interface RawContact {
	readonly name?: unknown
	readonly role?: unknown
	readonly email?: unknown
	readonly phone?: unknown
	readonly citations?: unknown
}

const citationsArray = (c: RawContact): ReadonlyArray<unknown> =>
	Array.isArray(c.citations) ? c.citations : []

/**
 * Union the broad and recovered contacts, keyed on the normalized name. A name seen
 * in both keeps the broad contact's fields, fills any it lacks (a title, a channel)
 * from the recovered one, and unions their citations. First-seen order is preserved.
 */
export const mergeContacts = (
	broad: ReadonlyArray<RawContact>,
	rescued: ReadonlyArray<RawContact>,
): ReadonlyArray<RawContact> => {
	const byKey = new Map<string, RawContact>()
	const order: string[] = []

	const absorb = (c: RawContact): void => {
		if (typeof c.name !== 'string') return
		const key = normalizeContactName(c.name)
		if (key === '') return
		const existing = byKey.get(key)
		if (existing === undefined) {
			byKey.set(key, c)
			order.push(key)
			return
		}
		byKey.set(key, {
			name: existing.name,
			role: existing.role ?? c.role,
			email: existing.email ?? c.email,
			phone: existing.phone ?? c.phone,
			citations: [...citationsArray(existing), ...citationsArray(c)],
		})
	}

	for (const c of broad) absorb(c)
	for (const c of rescued) absorb(c)
	return order.map(key => byKey.get(key) as RawContact)
}
