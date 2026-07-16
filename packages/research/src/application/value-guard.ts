/**
 * Strips values from a run's findings that were never seen in its evidence.
 *
 * The citation guard proves a cited page was fetched; it does not prove the page
 * said what the finding claims. So a confident model can still invent a phone, a
 * tax id, or an email and attach a real scraped URL to it. This guard closes that
 * gap by checking high-precision values against the evidence corpus — the scraped
 * page content plus the results of the registry and contact-discovery tools, so a
 * genuinely verified email or tax id is in the corpus and survives. (The corpus
 * deliberately excludes the model's own prose, so a value it merely asserted
 * cannot confirm itself.)
 *
 * Three actions, by where the value sits:
 *  - a proposed CRM update (`proposed_updates`) with any unsupported checkable
 *    value in its own fields is dropped whole — an invented write must never
 *    reach the CRM; surviving proposals are still cleaned of invented channels;
 *  - a contact channel (email/phone) whose value is unsupported is dropped;
 *  - a dedicated email or phone field anywhere else holding an unsupported value
 *    is blanked.
 *
 * Precise values are checked directly (emails, and phone/tax-id digit strings).
 * Most free text is too fuzzy to confirm or refute and is left untouched — but a
 * proposed CRM change is a write, so its few fields that are supposed to read off a
 * page (a place, a tool's name) are also held to the evidence, catching a made-up
 * address that carries no email or digits to check. Structural references (a
 * `company_id`), bookkeeping fields (version, status), and bare short numbers
 * (years, small counts) stay untouched.
 */

import {
	isInCorpus,
	PAGE_LITERAL_FIELDS,
	valueIsRightKind,
} from './scalar-field-guard'

// A field value that IS exactly an email (used when blanking a dedicated field).
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
// Emails found anywhere inside a value (a proposal field is a CRM write, so an
// invented address embedded in prose is still a risk).
const EMAIL_G = /[^@\s]+@[^@\s]+\.[^@\s]+/g
// A field value that is ONLY a phone number (digits and phone separators) — used
// when blanking a dedicated phone field, so prose that merely mentions a number
// is not nulled.
const PHONE_ONLY_RE = /^[+(]?[\d\s().-]{7,}$/
// A maximal phone-like digit run inside text: keeps phone-internal separators so
// a spaced number stays one run, later reduced to bare digits.
const PHONE_RUN = /[+(]?\d[\d\s().-]{5,}\d/g

const digitsOnly = (value: string): string => value.replace(/\D/g, '')

// Structural / bookkeeping keys on a proposal — references and metadata, not
// contact details the model could fabricate. A `company_id` UUID is a real
// reference that never appears in scraped page text, so value-checking it would
// drop every legitimate create.
const STRUCTURAL_KEYS = new Set([
	'id',
	'proposal_id',
	'proposalId',
	'subject_id',
	'subjectId',
	'subject_table',
	'subjectTable',
	'company_id',
	'companyId',
	'expected_version',
	'expectedVersion',
	'version',
	'operation',
	'status',
])

interface Evidence {
	readonly lowerCorpus: string
	readonly digitRuns: ReadonlyArray<string>
}

const digitRunsOf = (text: string): string[] =>
	(text.match(PHONE_RUN) ?? []).map(digitsOnly).filter(d => d.length >= 7)

const emailsIn = (value: string): string[] => value.match(EMAIL_G) ?? []

const digitsIn = (value: string): string[] =>
	(value.match(PHONE_RUN) ?? []).map(digitsOnly).filter(d => d.length >= 7)

const emailSupported = (ev: Evidence, email: string): boolean =>
	ev.lowerCorpus.includes(email.trim().toLowerCase())

// A phone/tax-id (≥7 digits) is supported when some corpus run equals it or
// differs only by a leading country code — one is a suffix of the other, sharing
// at least 7 trailing digits. Matching per-run (not against the whole corpus's
// concatenated digits) avoids coincidental hits that span two unrelated numbers.
const digitsSupported = (ev: Evidence, value: string): boolean => {
	const v = digitsOnly(value)
	if (v.length < 7) return true
	return ev.digitRuns.some(r => {
		const [long, short] = v.length >= r.length ? [v, r] : [r, v]
		return short.length >= 7 && long.endsWith(short)
	})
}

// Every email/phone the value carries is present in the evidence.
const stringSupported = (ev: Evidence, value: string): boolean =>
	emailsIn(value).every(e => emailSupported(ev, e)) &&
	digitsIn(value).every(d => digitsSupported(ev, d))

export interface ValueProvenanceResult {
	readonly findings: unknown
	/** Proposed CRM writes dropped because a value in them was invented. */
	readonly droppedProposals: number
	/** Contact channels + descriptive email/phone fields removed as invented. */
	readonly strippedValues: number
}

export const verifyValueProvenance = (
	findings: unknown,
	corpus: string,
): ValueProvenanceResult => {
	const ev: Evidence = {
		lowerCorpus: corpus.toLowerCase(),
		digitRuns: digitRunsOf(corpus),
	}

	let droppedProposals = 0
	let strippedValues = 0

	// One field of a proposed CRM write is grounded when nothing invented can slip
	// through it. Structural keys and non-string values are references, not facts a
	// model could fabricate, so they pass untouched.
	const fieldGrounded = (key: string, raw: unknown): boolean => {
		if (STRUCTURAL_KEYS.has(key)) return true
		if (typeof raw !== 'string') return true
		// Any email, phone, or tax id it carries must appear in the evidence.
		if (!stringSupported(ev, raw)) return false
		// A location must name a place, not how far the company reaches ("15
		// countries throughout the world"); this holds whatever the evidence says.
		if (!valueIsRightKind(key, raw)) return false
		// A value that is meant to read off a page — a place, a tool's name — carries
		// no email or digits for the check above to catch, so a made-up one (a wrong
		// city, a company that never operated there) would otherwise sail through.
		// Hold its wording to the evidence too. Skipped when there is no evidence to
		// check against, as on a resumed run, so a real value is never dropped for
		// want of a corpus.
		if (PAGE_LITERAL_FIELDS.has(key) && ev.lowerCorpus.length > 0) {
			return isInCorpus(raw, ev.lowerCorpus)
		}
		return true
	}

	// A proposal is grounded when every field of its own is. `fields` sometimes
	// arrives as raw prose rather than an object; a nested array (e.g. channels) is
	// left for the walk to clean.
	const proposalGrounded = (fields: unknown): boolean => {
		if (typeof fields === 'string') return stringSupported(ev, fields)
		if (fields === null || typeof fields !== 'object' || Array.isArray(fields))
			return true
		return Object.entries(fields as Record<string, unknown>).every(
			([key, raw]) => fieldGrounded(key, raw),
		)
	}

	// A channel survives only if its reachable value is in the evidence; handle/
	// url channels (linkedin, x, website) are not value-checked.
	const channelGrounded = (channel: unknown): boolean => {
		const record = channel as { kind?: unknown; value?: unknown }
		if (typeof record.value !== 'string') return true
		if (record.kind === 'email')
			return emailsIn(record.value).every(e => emailSupported(ev, e))
		if (record.kind === 'phone' || record.kind === 'whatsapp')
			return digitsSupported(ev, record.value)
		return true
	}

	const walk = (value: unknown, key?: string): unknown => {
		if (Array.isArray(value)) {
			if (key === 'proposed_updates') {
				// Drop a whole proposed write whose own fields carry an invented
				// value; still walk survivors so an invented nested channel is
				// stripped without discarding an otherwise-grounded proposal.
				return value
					.filter(proposal => {
						const ok = proposalGrounded(
							(proposal as { fields?: unknown }).fields,
						)
						if (!ok) droppedProposals++
						return ok
					})
					.map(proposal => walk(proposal))
			}
			if (key === 'channels') {
				return value.filter(channel => {
					const ok = channelGrounded(channel)
					if (!ok) strippedValues++
					return ok
				})
			}
			return value.map(item => walk(item))
		}
		if (value !== null && typeof value === 'object') {
			// A per-field Sourced wrapper ({ value, source_id, … }): check its inner
			// value the same way as a dedicated field, but blank the WHOLE field to
			// null when the email/phone is invented, rather than leaving a
			// sourced-but-empty { value: null } behind.
			const wrapper = value as { value?: unknown; source_id?: unknown }
			if ('value' in wrapper && typeof wrapper.source_id === 'string') {
				if (typeof wrapper.value === 'string') {
					const t = wrapper.value.trim()
					if (EMAIL_RE.test(t) && !emailSupported(ev, t)) {
						strippedValues++
						return null
					}
					if (
						PHONE_ONLY_RE.test(t) &&
						digitsOnly(t).length >= 7 &&
						!digitsSupported(ev, t)
					) {
						strippedValues++
						return null
					}
				}
				return value
			}
			return Object.fromEntries(
				Object.entries(value as Record<string, unknown>).map(([k, v]) => {
					if (typeof v === 'string') {
						const t = v.trim()
						// A dedicated email field holding an invented address.
						if (EMAIL_RE.test(t) && !emailSupported(ev, t)) {
							strippedValues++
							return [k, null] as const
						}
						// A dedicated phone field (only digits + separators) unsupported.
						if (
							PHONE_ONLY_RE.test(t) &&
							digitsOnly(t).length >= 7 &&
							!digitsSupported(ev, t)
						) {
							strippedValues++
							return [k, null] as const
						}
					}
					return [k, walk(v, k)] as const
				}),
			)
		}
		return value
	}

	return { findings: walk(findings), droppedProposals, strippedValues }
}
