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
	deriveEntityTargets,
	domainHost,
	type EntityTargets,
	namesNobodyInParticular,
} from './entity-guard'
import { isValueWrapper, unwrapValue } from './guard-shapes'
import { isInCorpus } from './scalar-field-guard'
import { isFirstPartyHost } from './source-tier-guard'

// A proper name (one to five capitalised words) directly followed by a company
// marker — the shape of "<Company> Inc" / "Caraway Logistics". The markers include
// the sector words that routinely form logistics company names.
const ORG_PHRASE =
	/\b([A-Z][A-Za-z0-9&.'’-]*(?:\s+[A-Z][A-Za-z0-9&.'’-]*){0,4})\s+(Inc|LLC|Corp|Corporation|Ltd|Co|Company|Group|Holdings|Logistics|Transport|Transportation|Freight|Shipping|Solutions|Technologies|Systems|Industries|Services|Partners|GmbH|S\.?A|S\.?L|Srl|BV|AG|Pty|PLC)\b\.?/g

// The markers that are as often the back half of a job title as the back half of
// a company: "Director of Client Services", "Head of Technical Solutions", "VP
// Business Systems". Every other marker in the pattern above names a company
// wherever it turns up, and is read as written.
const ALSO_TITLE_WORDS = new Set([
	'Services',
	'Solutions',
	'Systems',
	'Technologies',
	'Partners',
	'Industries',
])

// Words that put a person AT an organisation, so what follows one is an employer
// and not the rest of what they are called.
const WORKS_AT = /(?:\bat|\bfrom|\bwith)\s+$/i

/**
 * The companies a quote names.
 *
 * Every phrase counts but one shape: a marker that doubles as half a job title,
 * with nothing before it placing anybody at a company. Counting those too read
 * "Director of Client Services" as a firm called Client Services and threw a
 * real employee off her own company's row.
 *
 * Deliberately no wider than that. Asking every phrase for a word that places
 * somebody first lost the commonest shapes there are — "Mark Riskowitz, VP of
 * Operations, Caraway Logistics" and "Caraway Logistics promotes Andrew Smith",
 * where the employer just follows a comma or opens the sentence.
 */
const orgPhrasesIn = (text: string): ReadonlyArray<string> =>
	[...text.matchAll(ORG_PHRASE)]
		.filter(
			m =>
				!ALSO_TITLE_WORDS.has((m[2] ?? '').replace(/\.$/, '')) ||
				WORKS_AT.test(text.slice(0, m.index)),
		)
		.map(m => `${m[1]} ${m[2]}`)

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
	/** Contacts dropped because nothing was left saying where they were read. */
	readonly droppedUncited: number
	/** Contacts dropped because only a directory about the company named them. */
	readonly droppedOffSite: number
	/** Titles removed because the pages the run read never say them. */
	readonly droppedTitles: number
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
		return {
			findings,
			dropped: 0,
			droppedUncited: 0,
			droppedOffSite: 0,
			droppedTitles: 0,
		}
	}
	const contacts = (findings as { contacts?: unknown }).contacts
	if (!Array.isArray(contacts))
		return {
			findings,
			dropped: 0,
			droppedUncited: 0,
			droppedOffSite: 0,
			droppedTitles: 0,
		}

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
		// Never any here: a run about one company has steps of its own for a person
		// with no source to their name and for a title nothing supports, and they
		// run later in the chain.
		droppedUncited: 0,
		droppedOffSite: 0,
		droppedTitles: 0,
	}
}

/**
 * A row read as the thing a guard checks against — the same shape a run about one
 * company builds for its subject, from the only two things a row knows about
 * itself: what it is called and the address it gave.
 *
 * This is what lets a search reuse the checks written for a single company rather
 * than keep a second copy of each. Null when the row says nothing distinctive
 * enough to tell it from any other company on the list.
 */
const rowTargets = (row: Record<string, unknown>): EntityTargets | null => {
	const website = row['website']
	const address = isValueWrapper(website)
		? unwrapValue(website)
		: typeof website === 'string'
			? website
			: undefined
	return deriveEntityTargets({
		schemaName: 'company_enrichment_v1',
		query: '',
		subjects: [
			{
				table: 'companies',
				name: typeof row['name'] === 'string' ? row['name'] : undefined,
				website: typeof address === 'string' ? address : undefined,
			},
		],
	}).targets
}

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
	corpus = '',
): ContactEntityResult => {
	const nothingToDo = {
		findings,
		dropped: 0,
		droppedUncited: 0,
		droppedOffSite: 0,
		droppedTitles: 0,
	}
	if (
		listField === undefined ||
		findings === null ||
		typeof findings !== 'object' ||
		Array.isArray(findings)
	) {
		return nothingToDo
	}
	const rows = (findings as Record<string, unknown>)[listField]
	if (!Array.isArray(rows)) return nothingToDo
	const lowerCorpus = corpus.toLowerCase()

	let dropped = 0
	let droppedUncited = 0
	let droppedOffSite = 0
	let droppedTitles = 0
	const keptRows = rows.map(row => {
		if (row === null || typeof row !== 'object') return row
		const record = row as Record<string, unknown>
		const contacts = record['contacts']
		if (!Array.isArray(contacts)) return row
		// A row with neither a name of its own nor an address cannot say whose
		// staff anybody is — every quote would answer to it. Only that comparison
		// is skipped, though: whether a person came with any evidence at all is
		// not a question about the row, so it is still asked below.
		const targets = rowTargets(record)

		const keptContacts: unknown[] = []
		for (const contact of contacts) {
			if (contact === null || typeof contact !== 'object') {
				keptContacts.push(contact)
				continue
			}
			const held = contact as Record<string, unknown>
			// Nothing says where this person was read. Either the model named a
			// page the run never fetched — the citation guard, which runs before
			// this, will have just taken it away — or it named none at all. A run
			// about one company refuses such a person; a search returning fifty
			// has fifty times the reason to.
			const citations = held['citations']
			if (!Array.isArray(citations) || citations.length === 0) {
				droppedUncited++
				continue
			}
			if (targets === null) {
				keptContacts.push(contact)
				continue
			}
			// Only the company's own pages may name its people. A directory about
			// the company is not the company saying so: its rosters are scraped,
			// years old, and list people who left — and a search reaching fifty
			// firms will meet far more directories than team pages. Asked only of
			// a row that gave an address, because without one there is nothing to
			// tell a company's own site from a page about it.
			if (targets.domains.length > 0) {
				const hosts = citations.flatMap(citation => {
					const id = (citation as Record<string, unknown>)['source_id']
					const host = typeof id === 'string' ? domainHost(id) : undefined
					return host === undefined ? [] : [host]
				})
				if (
					hosts.length > 0 &&
					!hosts.some(host => isFirstPartyHost(host, targets.domains))
				) {
					droppedOffSite++
					continue
				}
			}
			const orgs = orgPhrasesIn(contactQuotes(held))
			// No company named in the evidence reads the same for a real member of
			// staff as for a stranger, and losing real people is the worse mistake.
			//
			// A phrase of nothing but the trade — "Logistica SL" — names no company
			// in particular either, so it cannot be evidence that this person
			// belongs to a different one. Dropped from the reckoning rather than
			// read as a stranger, which would take the gerente off a haulier named
			// after what it does.
			const named = orgs.filter(org => !namesNobodyInParticular(org))
			// Any reading but "names nobody this row could be" keeps the person. A
			// page saying "Sentmenat Group" where the row reads "Calderería
			// Sentmenat SL" names one word of it and no more, which is as much as a
			// company gets called in passing — and the row's own address answers
			// for it too, which is how a company listed under its legal name keeps
			// the staff its trading name is quoted with.
			if (
				named.length > 0 &&
				!named.some(org => classifyEntityMatch(targets, org) !== 'absent')
			) {
				dropped++
				continue
			}
			// The title is kept only if a page the run read actually says it. Asked
			// because a model handed a person with no stated title writes one and
			// says so in the same breath — "Director/a (the page does not give the
			// exact title)" reached a real row — and a made-up title is worse than
			// none: it is what somebody opens a call with.
			const role = held['role']
			if (
				lowerCorpus !== '' &&
				typeof role === 'string' &&
				role.trim() !== '' &&
				!isInCorpus(role, lowerCorpus, { acronyms: true })
			) {
				droppedTitles++
				const { role: _removed, ...withoutRole } = held
				keptContacts.push(withoutRole)
				continue
			}
			keptContacts.push(contact)
		}
		return keptContacts.length === contacts.length &&
			keptContacts.every((kept, i) => kept === contacts[i])
			? row
			: { ...record, contacts: keptContacts }
	})

	return dropped === 0 &&
		droppedUncited === 0 &&
		droppedOffSite === 0 &&
		droppedTitles === 0
		? nothingToDo
		: {
				findings: { ...(findings as object), [listField]: keptRows },
				dropped,
				droppedUncited,
				droppedOffSite,
				droppedTitles,
			}
}
