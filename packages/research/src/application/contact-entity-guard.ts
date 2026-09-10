/**
 * Drops a contact whose own evidence ties them to a *different* company.
 *
 * A company's site often quotes people who don't work there — a client
 * testimonial, a partner, a competitor's executive in a press mention. The broad
 * and rescue extractions pick those up as "contacts", and because the quote sits on
 * the target's own page the source-based checks can't tell them apart. The one
 * reliable signal is the quote itself naming the person's employer: "…, VP of
 * Operations at Caraway Logistics" names Caraway, not the company being researched.
 *
 * So this guard reads each contact's supporting quotes, pulls out any company-like
 * name they mention (a proper name followed by a company marker — Inc, Ltd,
 * Logistics, Group, …), and drops the contact when every company its evidence names
 * is some *other* company and none is the target. A contact whose quotes name no
 * company, or name the target, is kept: a testimonial that names nobody's employer
 * reads the same as a real member of staff, and losing real people is the worse of
 * the two mistakes.
 */

import {
	classifyEntityMatch,
	DISTINCTIVE_NAME_LENGTH,
	type EntityTargets,
	nameCoreTokens,
} from './entity-guard'

// A proper name (one to five capitalised words) directly followed by a company
// marker — the shape of "<Company> Inc" / "Caraway Logistics". The markers include
// the sector words that routinely form logistics company names.
const ORG_PHRASE =
	/\b([A-Z][A-Za-z0-9&.'’-]*(?:\s+[A-Z][A-Za-z0-9&.'’-]*){0,4})\s+(Inc|LLC|Corp|Corporation|Ltd|Co|Company|Group|Holdings|Logistics|Transport|Transportation|Freight|Shipping|Solutions|Technologies|Systems|Industries|Services|Partners|GmbH|S\.?A|S\.?L|Srl|BV|AG|Pty|PLC)\b\.?/g

const orgPhrasesIn = (text: string): ReadonlyArray<string> =>
	[...text.matchAll(ORG_PHRASE)].map(m => `${m[1]} ${m[2]}`)

// Every quote a contact carries: its per-field sources (role/email/phone) and its
// own citation list. These are what tie — or fail to tie — the person to the target.
const contactQuotes = (contact: Record<string, unknown>): string => {
	const parts: string[] = []
	for (const key of ['role', 'email', 'phone']) {
		const field = contact[key]
		if (
			field !== null &&
			typeof field === 'object' &&
			typeof (field as { quote?: unknown }).quote === 'string'
		) {
			parts.push((field as { quote: string }).quote)
		}
	}
	const citations = contact['citations']
	if (Array.isArray(citations)) {
		for (const c of citations) {
			if (
				c !== null &&
				typeof c === 'object' &&
				typeof (c as { quote?: unknown }).quote === 'string'
			) {
				parts.push((c as { quote: string }).quote)
			}
		}
	}
	return parts.join(' ')
}

export interface ContactEntityResult {
	readonly findings: unknown
	/** Contacts dropped because their evidence named only a different company. */
	readonly dropped: number
}

/**
 * Remove contacts whose supporting quotes name only other companies. `targets` are
 * the run's entity targets; a null/absent target (a discovery scan) is a no-op.
 */
export const bindContactsToEntity = (
	findings: unknown,
	targets: EntityTargets | null,
): ContactEntityResult => {
	if (
		targets === null ||
		findings === null ||
		typeof findings !== 'object' ||
		Array.isArray(findings)
	) {
		return { findings, dropped: 0 }
	}
	const contacts = (findings as { contacts?: unknown }).contacts
	if (!Array.isArray(contacts)) return { findings, dropped: 0 }

	let dropped = 0
	const kept = contacts.filter(contact => {
		if (contact === null || typeof contact !== 'object') return true
		const orgs = orgPhrasesIn(contactQuotes(contact as Record<string, unknown>))
		// No company named in the evidence → can't tell from here; keep and let the
		// critic judge. A company named → keep only if one of them is the target.
		if (orgs.length === 0) return true
		const namesTarget = orgs.some(
			org => classifyEntityMatch(targets, org) === 'strong',
		)
		if (!namesTarget) dropped++
		return namesTarget
	})

	return {
		findings: { ...(findings as object), contacts: kept },
		dropped,
	}
}

// The words in a company's name that could tell it from another one — its own
// words, with the trade and the legal form taken off, and anything too short to
// carry a name on its own.
const distinctiveWordsOf = (name: string): ReadonlySet<string> =>
	new Set(
		nameCoreTokens(name).filter(word => word.length >= DISTINCTIVE_NAME_LENGTH),
	)

/**
 * The same check for a search that returns many companies, each carrying the
 * people its own pages named.
 *
 * The run has no one company to hold a person against — every row is a different
 * one — so each row is checked against itself: a person kept on a row must not be
 * evidenced only by a quote naming somebody else. Without it the likeliest
 * mistake is the quiet one, where a director read on one company's page is filed
 * under the company listed above it.
 *
 * A row whose own name is too short or too plain to tell companies apart keeps
 * everyone. Half a check, applied confidently, drops real people.
 */
export const bindScanContactsToRows = (
	findings: unknown,
	listField: string | undefined,
): ContactEntityResult => {
	if (
		listField === undefined ||
		findings === null ||
		typeof findings !== 'object' ||
		Array.isArray(findings)
	) {
		return { findings, dropped: 0 }
	}
	const rows = (findings as Record<string, unknown>)[listField]
	if (!Array.isArray(rows)) return { findings, dropped: 0 }

	let dropped = 0
	const keptRows = rows.map(row => {
		if (row === null || typeof row !== 'object') return row
		const record = row as Record<string, unknown>
		const contacts = record['contacts']
		if (!Array.isArray(contacts)) return row
		const own = distinctiveWordsOf(
			typeof record['name'] === 'string' ? record['name'] : '',
		)
		// A name with nothing distinctive in it would answer to any quote, so the
		// check is skipped rather than run on a word that cannot decide anything.
		if (own.size === 0) return row

		const keptContacts = contacts.filter(contact => {
			if (contact === null || typeof contact !== 'object') return true
			const orgs = orgPhrasesIn(
				contactQuotes(contact as Record<string, unknown>),
			)
			// No company named in the evidence reads the same for a real member of
			// staff as for a stranger, and losing real people is the worse mistake.
			if (orgs.length === 0) return true
			// One word in common is enough, and prefix matching is not: a page says
			// "Sentmenat Group" where the row reads "Calderería Sentmenat SL", and
			// neither spells the other from its first letter.
			const namesThisRow = orgs.some(org =>
				[...distinctiveWordsOf(org)].some(word => own.has(word)),
			)
			if (!namesThisRow) dropped++
			return namesThisRow
		})
		return keptContacts.length === contacts.length
			? row
			: { ...record, contacts: keptContacts }
	})

	return dropped === 0
		? { findings, dropped: 0 }
		: { findings: { ...(findings as object), [listField]: keptRows }, dropped }
}
