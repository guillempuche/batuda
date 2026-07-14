/**
 * A model-backed check that each extracted contact is really the target company's
 * OWN person — not a client, a partner, or a competitor's executive quoted on the
 * same page.
 *
 * The deterministic contact-entity guard drops a contact only when a supporting
 * quote names a *different* company outright ("…, VP of Operations at Caraway
 * Logistics"). A subtler case slips past it, as that guard's own comment admits: a
 * customer testimonial whose quote names no company at all ("Great service! — Jane,
 * operations lead"). This asks a model, one question per contact, whether the person
 * is the target's own staff — and, like the field critic it is modelled on, it is
 * gentle: it drops a contact only on a clear "no", keeps anyone it cannot rule out,
 * and keeps everyone if the judge call fails. So it lifts precision without losing a
 * real decision-maker to a thin quote.
 *
 * The judge is injected, so the walk stays pure and unit-testable without a model;
 * research-service wires the judge to the extract tier and fails open.
 */

import { Effect, Schema } from 'effect'

// One contact to audit: its position in the list (the id), the person's name, and
// the quotes that tie — or fail to tie — them to the target: each channel's own
// quote plus the contact's citation quotes.
export interface ContactClaim {
	readonly id: string
	readonly name: string
	readonly quotes: ReadonlyArray<string>
}

// The judge's ruling on one contact: this company's own person ('own_staff', keep),
// clearly someone else's ('outsider', drop — a client, partner, vendor, or
// competitor), or unclear ('unsure', keep — not clearly outside, so kept rather than
// lose a real person to a thin quote).
export type ContactVerdictType = 'own_staff' | 'outsider' | 'unsure'

export interface ContactVerdict {
	readonly id: string
	readonly verdict: ContactVerdictType
	readonly reason?: string
}

export interface ContactJudgeResult {
	readonly verdicts: ReadonlyArray<ContactVerdict>
	readonly outputTokens: number
}

// The injected model-backed check: rules on a batch of contacts in one call.
export type ContactEntityJudge<E = never, R = never> = (
	claims: ReadonlyArray<ContactClaim>,
) => Effect.Effect<ContactJudgeResult, E, R>

export interface ContactCritiqueResult {
	readonly findings: unknown
	/** Contacts sent to the judge. */
	readonly criticised: number
	/** Contacts the judge clearly ruled outsiders and this dropped. */
	readonly dropped: number
	readonly outputTokens: number
}

export interface ContactCriticTarget {
	readonly name: string
	readonly domain?: string | undefined
}

// The strict json_schema the wired judge fills — also embedded in the prompt, per
// the extract tier's schema-in-both-places rule.
export const ContactVerdictsSchema = Schema.Struct({
	verdicts: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			verdict: Schema.Literals(['own_staff', 'outsider', 'unsure']),
			reason: Schema.optionalKey(Schema.String),
		}),
	),
})

// Every quote a contact carries: its per-channel sources (role/email/phone) and its
// own citation list. Kept local to this module so the two contact guards stay
// independent even though they read the same shape.
const contactQuotes = (contact: Record<string, unknown>): string[] => {
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
	return parts
}

const contactsOf = (findings: unknown): ReadonlyArray<unknown> | undefined => {
	if (
		findings === null ||
		typeof findings !== 'object' ||
		Array.isArray(findings)
	)
		return undefined
	const contacts = (findings as { contacts?: unknown }).contacts
	return Array.isArray(contacts) ? contacts : undefined
}

export const collectContactClaims = (
	findings: unknown,
): ReadonlyArray<ContactClaim> => {
	const contacts = contactsOf(findings)
	if (contacts === undefined) return []
	const claims: ContactClaim[] = []
	contacts.forEach((contact, i) => {
		if (contact === null || typeof contact !== 'object') return
		const c = contact as Record<string, unknown>
		const name = typeof c['name'] === 'string' ? c['name'] : ''
		if (name.trim() === '') return
		const quotes = contactQuotes(c)
		// A contact with no quotes gives the judge nothing to reason over — leave it
		// to the deterministic guard and keep it (fail-open), so it is not sent.
		if (quotes.length === 0) return
		claims.push({ id: String(i), name, quotes })
	})
	return claims
}

export const applyContactVerdicts = (
	findings: unknown,
	verdicts: ReadonlyArray<ContactVerdict>,
): { readonly findings: unknown; readonly dropped: number } => {
	const contacts = contactsOf(findings)
	if (contacts === undefined) return { findings, dropped: 0 }
	// Only a clear 'outsider' removes a contact; 'own_staff', 'unsure', an unknown
	// id, or no verdict all keep it exactly as the guards produced it — the critic
	// never removes what it did not clearly rule against.
	const drop = new Set(
		verdicts.filter(v => v.verdict === 'outsider').map(v => v.id),
	)
	let dropped = 0
	const kept = contacts.filter((_contact, i) => {
		if (drop.has(String(i))) {
			dropped++
			return false
		}
		return true
	})
	if (dropped === 0) return { findings, dropped: 0 }
	return { findings: { ...(findings as object), contacts: kept }, dropped }
}

export const critiqueContactEntities = <E, R>(
	findings: unknown,
	judge: ContactEntityJudge<E, R>,
): Effect.Effect<ContactCritiqueResult, E, R> =>
	Effect.gen(function* () {
		const claims = collectContactClaims(findings)
		// No named, quoted contacts (a scan/freeform schema, or people the guards
		// already stripped) → don't spend a model call.
		if (claims.length === 0) {
			return { findings, criticised: 0, dropped: 0, outputTokens: 0 }
		}
		const { verdicts, outputTokens } = yield* judge(claims)
		const { findings: applied, dropped } = applyContactVerdicts(
			findings,
			verdicts,
		)
		return {
			findings: applied,
			criticised: claims.length,
			dropped,
			outputTokens,
		}
	})

// Builds the judge prompt: the target, the acceptance question, and the contact
// list. The schema is passed to generateObject and also named here so the model
// sees the shape in both places.
export const contactCriticPrompt = (
	target: ContactCriticTarget,
	claims: ReadonlyArray<ContactClaim>,
): string => {
	const rows = claims
		.map(
			c =>
				`- id=${c.id} name=${JSON.stringify(c.name)} quotes=${JSON.stringify(
					c.quotes,
				)}`,
		)
		.join('\n')
	return [
		`You are auditing people extracted as contacts of the company "${target.name}"${
			target.domain ? ` (official site ${target.domain})` : ''
		}.`,
		'Each person was pulled from a quote on the research evidence. For each, decide',
		"whether they are this company's OWN leader or employee, or someone else quoted",
		'alongside it. Return exactly one verdict per id:',
		'- "own_staff": the quote shows this person works for the target company (a',
		'  founder, executive, or employee).',
		'- "outsider": the quote shows this person belongs to a DIFFERENT company — a',
		'  client or customer giving a testimonial, a partner, a vendor, or a competitor.',
		'  A quote that praises, thanks, or recommends the company is almost always a',
		'  customer testimonial, so its speaker is an outsider. Use "outsider" ONLY when',
		"  you are confident the person is not the target's own staff.",
		'- "unsure": you cannot tell from the quote. Prefer "unsure" over "outsider"',
		'  whenever in doubt; the person is kept rather than dropped.',
		'Return exactly one verdict per id, matching the id verbatim.',
		'',
		'People:',
		rows,
	].join('\n')
}
