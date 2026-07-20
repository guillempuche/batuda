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
	/** The host of the page it was read from — where the value is grounded. */
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
					source_id: page.host ?? domain,
					quote: line.trim().slice(0, 200),
					rank: rankOf(localPart),
				})
			}
		}
	}
	return found
		.sort((a, b) => a.rank - b.rank)
		.map(({ rank: _rank, ...email }) => email)
}
