/**
 * Drops proposed CRM updates whose specific, checkable values were never seen in
 * the run's evidence.
 *
 * The citation guard proves a cited page was fetched; it does not prove the page
 * said what the finding claims. So a confident model can still invent a phone, a
 * tax id, or an email and attach a real scraped URL to it. This guard closes that
 * gap for the values that reach the CRM: it checks each proposed update's
 * high-precision fields (emails, and phone/tax-id-like digit strings) against the
 * evidence corpus — the scraped page content plus the tool transcript — and drops
 * the whole proposal if any such value is absent (i.e. invented).
 *
 * Only high-precision values are checked. Free text (industry, size ranges,
 * notes) is too fuzzy to confirm or refute and is left untouched; and only
 * proposed_updates — the path that writes to the CRM — are gated, since verified
 * contact channels carry their own deliverability provenance.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const digitsOnly = (value: string): string => value.replace(/\D/g, '')

interface Checkable {
	readonly kind: 'email' | 'digits'
	readonly value: string
}

// Pull the checkable values out of a proposal's field map: emails, and
// digit-heavy strings (phones, tax ids / EINs). Short digit runs (years, small
// counts) are ignored — they match too easily to mean anything.
const checkableValues = (fields: Record<string, unknown>): Checkable[] => {
	const out: Checkable[] = []
	for (const raw of Object.values(fields)) {
		if (typeof raw !== 'string') continue
		const value = raw.trim()
		if (EMAIL_RE.test(value)) {
			out.push({ kind: 'email', value: value.toLowerCase() })
			continue
		}
		const digits = digitsOnly(value)
		if (digits.length >= 7) out.push({ kind: 'digits', value: digits })
	}
	return out
}

export interface ValueProvenanceResult {
	readonly findings: unknown
	readonly droppedProposals: number
}

export const verifyProposalProvenance = (
	findings: unknown,
	corpus: string,
): ValueProvenanceResult => {
	const lowerCorpus = corpus.toLowerCase()
	const digitCorpus = digitsOnly(corpus)
	const supported = (c: Checkable): boolean =>
		c.kind === 'email'
			? lowerCorpus.includes(c.value)
			: digitCorpus.includes(c.value)

	let droppedProposals = 0
	const walk = (value: unknown, key?: string): unknown => {
		if (Array.isArray(value)) {
			if (key === 'proposed_updates') {
				return value.filter(proposal => {
					const fields = (proposal as { fields?: unknown }).fields
					if (
						typeof fields !== 'object' ||
						fields === null ||
						Array.isArray(fields)
					)
						return true
					const ok = checkableValues(fields as Record<string, unknown>).every(
						supported,
					)
					if (!ok) droppedProposals++
					return ok
				})
			}
			return value.map(item => walk(item))
		}
		if (value !== null && typeof value === 'object') {
			return Object.fromEntries(
				Object.entries(value as Record<string, unknown>).map(
					([k, v]) => [k, walk(v, k)] as const,
				),
			)
		}
		return value
	}
	return { findings: walk(findings), droppedProposals }
}
