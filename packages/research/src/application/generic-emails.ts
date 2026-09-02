/**
 * Harvests a company's published role-based inboxes — `info@`, `sales@`,
 * `press@`, `hola@` — from the pages the run fetched.
 *
 * For a thin-web small or niche company that lists no named executive, a
 * department mailbox printed on its contact page is often the only actionable way
 * to reach it. Nothing else in the pipeline captures these: the email steps only
 * guess a *person's* address and verify it, and the value guard only ever strips
 * an invented email — it never harvests a real one.
 *
 * The capture is deliberately conservative, so it can never invent an address:
 *  - the local part must be a known role word (not a person's name);
 *  - the domain must belong to the company (a target domain, or the host of a
 *    page that is the company's own site) — so a supplier's `info@` quoted in a
 *    testimonial, or a directory's own mailbox, is ignored;
 *  - the address is read verbatim from a fetched page, with the line it sat on
 *    kept as the quote, so it is grounded by construction.
 */

import { clipText } from '@batuda/domain'

// Role / department local parts across the languages the pipeline researches in.
// A person's name is never in this list, so only shared mailboxes are captured.
const ROLE_LOCALPARTS = new Set([
	'info',
	'contact',
	'contacto',
	'contacte',
	'sales',
	'press',
	'media',
	'hello',
	'hola',
	'support',
	'office',
	'admin',
	'enquiries',
])

// Preference order when several role mailboxes are published: a general contact
// address first, then a sales one, then press/media, then the rest.
const PRIORITY: ReadonlyArray<string> = [
	'contact',
	'contacto',
	'contacte',
	'info',
	'hola',
	'hello',
	'sales',
	'press',
	'media',
	'support',
	'office',
	'admin',
	'enquiries',
]

const rankOf = (localPart: string): number => {
	const index = PRIORITY.indexOf(localPart)
	return index === -1 ? PRIORITY.length : index
}

// A plain email, restrictive enough that markdown link syntax around an address
// ("[info@acme.com](mailto:…)") yields the bare address, not the punctuation.
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

// The address's domain belongs to the company when it is one of the company's own
// hosts, or a subdomain of one.
const domainIsOwn = (
	domain: string,
	ownHosts: ReadonlyArray<string>,
): boolean =>
	ownHosts.some(host => domain === host || domain.endsWith(`.${host}`))

export interface GenericEmail {
	/** The role address, lower-cased. */
	readonly value: string
	/**
	 * The page the address was read from, named by the id the sources table keys
	 * that page by. Whoever stores this value later has to turn the name back into
	 * a page a reader can open, and only this id looks the page up — a bare host
	 * passes the "was this page seen" test and then resolves to nothing.
	 */
	readonly source_id: string
	/** The line the address sat on, so the capture is auditable. */
	readonly quote: string
}

/**
 * Scan the fetched pages for the company's published role mailboxes.
 *
 * `ownHosts` are the company's own domains (target domains plus the hosts of its
 * own-site pages); an address is kept only when its domain is one of them.
 * Results are de-duplicated and ordered by role preference, so the first is the
 * best general contact address.
 */
export const harvestGenericEmails = (
	pages: ReadonlyArray<{
		readonly text: string
		readonly sourceId: string
		readonly host?: string | undefined
	}>,
	ownHosts: ReadonlyArray<string>,
): ReadonlyArray<GenericEmail> => {
	if (ownHosts.length === 0) return []
	const seen = new Set<string>()
	const found: Array<GenericEmail & { readonly rank: number }> = []
	for (const page of pages) {
		for (const line of page.text.split(/\r?\n/)) {
			for (const raw of line.match(EMAIL_RE) ?? []) {
				const email = raw.toLowerCase()
				const at = email.indexOf('@')
				const localPart = email.slice(0, at).split('+')[0] ?? ''
				const domain = email.slice(at + 1)
				if (!ROLE_LOCALPARTS.has(localPart)) continue
				if (!domainIsOwn(domain, ownHosts)) continue
				if (seen.has(email)) continue
				seen.add(email)
				found.push({
					value: email,
					source_id: page.sourceId,
					quote: clipText(line.trim(), 200),
					rank: rankOf(localPart),
				})
			}
		}
	}
	return found
		.sort((a, b) => a.rank - b.rank)
		.map(({ rank: _rank, ...email }) => email)
}

/**
 * How sure we are of a harvested address, on the 0–1 scale the review surface
 * reads. It is 1 because the claim being made is narrow: this address is printed
 * on this page, read off it word for word. It says nothing about whether the
 * mailbox accepts mail — that is the deliverability verdict, which no one has
 * asked for yet, and which is what the unattended-write rule looks at.
 */
const HARVEST_CONFIDENCE = 1

/** The company row a harvested address can be proposed against. */
export interface MailboxSubject {
	readonly id: string
	readonly version: number | null
}

/**
 * Put a harvested role mailbox into the run's findings.
 *
 * Two places, because they answer two questions. The company profile gains the
 * address as one of its own fields, so a reader of the finished profile can see
 * how to reach the company — and so the run counts as having found something
 * rather than reading as empty. And when the run holds the company on file, the
 * address is also offered as a change for a person to accept or decline, which is
 * the only way it ever reaches the record itself.
 *
 * Both are additions only. An address the model already reported stands, and a
 * run that was handed no company row offers no change — there is nothing to
 * change yet.
 *
 * This must happen before the findings are stamped with review ids and before the
 * checks that grade them, so the offer gets an id a person can act on and is held
 * to the same standard as every other proposed change: an address whose page
 * turns out not to belong to this company is dropped here like any other.
 */
export const withRoleMailbox = (
	findings: unknown,
	harvested: ReadonlyArray<GenericEmail>,
	subject: MailboxSubject | undefined,
): unknown => {
	const best = harvested[0]
	if (
		best === undefined ||
		findings === null ||
		typeof findings !== 'object' ||
		Array.isArray(findings)
	)
		return findings

	const record = findings as Record<string, unknown>
	const enrichment =
		record['enrichment'] !== null &&
		typeof record['enrichment'] === 'object' &&
		!Array.isArray(record['enrichment'])
			? (record['enrichment'] as Record<string, unknown>)
			: {}
	const sourced = {
		value: best.value,
		source_id: best.source_id,
		quote: best.quote,
		confidence: HARVEST_CONFIDENCE,
	}
	// The model's own answer wins: it read the same pages and may have picked a
	// better address than the highest-ranked role word. An entry that is present but
	// holds nothing is not an answer, so it does not stand in the way.
	const reported = enrichment['email']
	const alreadyReported =
		reported !== null &&
		typeof reported === 'object' &&
		typeof (reported as { value?: unknown }).value === 'string' &&
		(reported as { value: string }).value.trim() !== ''
	const nextEnrichment = alreadyReported
		? enrichment
		: { ...enrichment, email: sourced }

	const existingProposals = Array.isArray(record['proposed_updates'])
		? record['proposed_updates']
		: []
	// The line the address sat on is the whole case for it, so it is also what a
	// reviewer is given as the reason. Writing a sentence here instead would put a
	// fixed English phrase in the pipeline for the web app to display untranslated.
	const proposal =
		subject === undefined
			? undefined
			: {
					subject_table: 'companies',
					subject_id: subject.id,
					expected_version: subject.version,
					fields: { email: sourced },
					reason: best.quote,
					citations: [
						{
							source_id: best.source_id,
							quote: best.quote,
							confidence: HARVEST_CONFIDENCE,
						},
					],
				}

	return {
		...record,
		enrichment: nextEnrichment,
		...(proposal === undefined
			? {}
			: { proposed_updates: [...existingProposals, proposal] }),
	}
}
