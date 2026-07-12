/**
 * Pure scoring for the contact-finding eval. Given a company's known
 * decision-makers (the golden expectation) and a normalized view of what one
 * discover_contacts run returned, it computes the numbers that decide whether a
 * paid enrichment vendor earns its cost:
 *
 *   contact recall           of the known contacts, how many did the run find (by name)?
 *   decision-maker recall    of the known *decision-makers*, how many did it find?
 *   email precision          of the deliverable emails it returned for a known
 *                            person, how many are the right address?
 *   empty rate               how often did it come back with nobody reliable?
 *   cost per verified        paid spend ÷ contacts returned with a deliverable
 *                            email — the number the vendor decision rests on.
 *
 * Recall metrics stay trustworthy even with a small golden set (extra real
 * contacts a run finds are not penalised); email precision is judged only over
 * people the golden set actually knows an address for.
 */

import { isDecisionMaker } from './contact-discovery'
import { foldDiacritics, normalizeText } from './eval-scoring'

export type ContactTerminalStatus =
	| 'ok'
	| 'no_reliable_contact'
	| 'budget_exceeded'

export interface GoldenContact {
	readonly name: string
	readonly role?: string | undefined
	readonly email?: string | undefined
}

/** One company's known decision-makers — the answer key a run is scored against. */
export interface ContactGoldenExpectation {
	readonly id: string
	readonly companyName: string
	readonly domain: string
	readonly country?: string | undefined
	readonly expectedContacts: ReadonlyArray<GoldenContact>
}

export interface OutcomeContact {
	readonly name: string
	readonly role?: string | undefined
	readonly isDecisionMaker: boolean
	/** The primary email channel, when the run returned a sendable address. */
	readonly email?:
		| { readonly value: string; readonly deliverable: boolean }
		| undefined
}

/**
 * A normalized view of one discover_contacts run, adapted from its outcome by
 * the caller. Keeping the adapter out of here means the DiscoveredContact shape
 * can change without touching a metric.
 */
export interface ContactRunOutcome {
	readonly status: ContactTerminalStatus
	readonly contacts: ReadonlyArray<OutcomeContact>
	/** Paid spend metered to this run (cents), summed across the vendors it invoked. */
	readonly spendCents: number
}

export interface ContactRunScore {
	readonly id: string
	readonly contactsExpected: number
	readonly contactsMatched: number
	readonly decisionMakersExpected: number
	readonly decisionMakersMatched: number
	/** Of the deliverable emails returned for a golden-known person, how many were checkable. */
	readonly emailDeliverableReturned: number
	/** Of those, how many match the golden address (precision numerator). */
	readonly emailDeliverableCorrect: number
	/** Every returned contact carrying a deliverable email — the cost-per-verified denominator. */
	readonly deliverableReturned: number
	readonly spendCents: number
	readonly empty: boolean
}

export interface ContactEvalSummary {
	readonly runs: number
	readonly contactRecall: number | null
	readonly decisionMakerRecall: number | null
	readonly emailPrecision: number | null
	readonly emptyRate: number
	/** Metered proxy: paid spend ÷ contacts with a deliverable email. Null when none were. */
	readonly costPerVerifiedContact: number | null
}

// Diacritic-folded, lower-cased name tokens: "María José García" →
// ["maria","jose","garcia"], so accents, casing, and extra middle names do not
// break a match.
const nameTokens = (name: string): string[] =>
	foldDiacritics(normalizeText(name))
		.split(/[^a-z0-9]+/)
		.filter(token => token.length > 0)

// A golden contact matches a returned one when the shorter name's tokens are all
// present in the longer — so "Maria Garcia" matches the fuller "Maria Garcia
// Lopez" but not "Maria Lopez". Requires ≥2 tokens so a lone first name never
// matches a stranger who happens to share it (a first-name-only return is not
// enough to confirm the same person).
const namesMatch = (a: string, b: string): boolean => {
	const ta = nameTokens(a)
	const tb = nameTokens(b)
	const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
	if (short.length < 2) return false
	return short.every(token => long.includes(token))
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase()

/** Score one discover_contacts run against a company's known decision-makers. */
export const scoreContactRun = (
	expected: ContactGoldenExpectation,
	outcome: ContactRunOutcome,
): ContactRunScore => {
	const findMatch = (golden: GoldenContact): OutcomeContact | undefined =>
		outcome.contacts.find(c => namesMatch(golden.name, c.name))

	let contactsMatched = 0
	let decisionMakersExpected = 0
	let decisionMakersMatched = 0
	let emailDeliverableReturned = 0
	let emailDeliverableCorrect = 0
	for (const golden of expected.expectedContacts) {
		const hit = findMatch(golden)
		if (hit !== undefined) contactsMatched++
		if (isDecisionMaker(golden.role, undefined)) {
			decisionMakersExpected++
			if (hit !== undefined) decisionMakersMatched++
		}
		if (golden.email !== undefined && hit?.email?.deliverable === true) {
			emailDeliverableReturned++
			if (normalizeEmail(hit.email.value) === normalizeEmail(golden.email)) {
				emailDeliverableCorrect++
			}
		}
	}

	return {
		id: expected.id,
		contactsExpected: expected.expectedContacts.length,
		contactsMatched,
		decisionMakersExpected,
		decisionMakersMatched,
		emailDeliverableReturned,
		emailDeliverableCorrect,
		deliverableReturned: outcome.contacts.filter(
			c => c.email?.deliverable === true,
		).length,
		spendCents: outcome.spendCents,
		empty: outcome.status !== 'ok',
	}
}

/** Roll per-run contact scores up into the rates the harness reports. */
export const summarizeContactScores = (
	scores: ReadonlyArray<ContactRunScore>,
): ContactEvalSummary => {
	const runs = scores.length
	if (runs === 0) {
		return {
			runs: 0,
			contactRecall: null,
			decisionMakerRecall: null,
			emailPrecision: null,
			emptyRate: 0,
			costPerVerifiedContact: null,
		}
	}

	let expected = 0
	let matched = 0
	let dmExpected = 0
	let dmMatched = 0
	let emailDenom = 0
	let emailNumer = 0
	let empty = 0
	let spend = 0
	let deliverable = 0
	for (const score of scores) {
		expected += score.contactsExpected
		matched += score.contactsMatched
		dmExpected += score.decisionMakersExpected
		dmMatched += score.decisionMakersMatched
		emailDenom += score.emailDeliverableReturned
		emailNumer += score.emailDeliverableCorrect
		if (score.empty) empty++
		spend += score.spendCents
		deliverable += score.deliverableReturned
	}

	return {
		runs,
		contactRecall: expected === 0 ? null : matched / expected,
		decisionMakerRecall: dmExpected === 0 ? null : dmMatched / dmExpected,
		emailPrecision: emailDenom === 0 ? null : emailNumer / emailDenom,
		emptyRate: empty / runs,
		costPerVerifiedContact: deliverable === 0 ? null : spend / deliverable,
	}
}
