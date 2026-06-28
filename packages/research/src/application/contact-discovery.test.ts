import { describe, expect, it } from 'vitest'

import type { VerificationVerdict } from '../domain/types'
import {
	compareContacts,
	type DiscoveredContact,
	emailChannel,
	isDecisionMaker,
} from './contact-discovery'

const contact = (over: {
	is_decision_maker?: boolean
	verification?: VerificationVerdict
	confidence?: number
}): DiscoveredContact => ({
	name: 'Test Person',
	is_decision_maker: over.is_decision_maker ?? false,
	channels: [
		{
			kind: 'email',
			value: 'test@acme.com',
			verification: over.verification ?? 'deliverable',
			confidence: over.confidence,
			is_primary: true,
		},
	],
})

describe('isDecisionMaker', () => {
	describe('when seniority marks the executive tier', () => {
		it('should flag an executive regardless of title', () => {
			// GIVEN Hunter seniority 'executive'
			// THEN the person counts as a decision-maker
			expect(isDecisionMaker(undefined, 'executive')).toBe(true)
		})
	})

	describe('when the title names a leadership role', () => {
		it('should match director / chief / head / founder titles', () => {
			// GIVEN common decision-maker titles
			// THEN each is recognised
			expect(isDecisionMaker('Managing Director', undefined)).toBe(true)
			expect(isDecisionMaker('Chief Financial Officer', undefined)).toBe(true)
			expect(isDecisionMaker('Head of Procurement', undefined)).toBe(true)
			expect(isDecisionMaker('Founder', undefined)).toBe(true)
		})

		it('should match three-letter C-suite abbreviations', () => {
			// GIVEN bare C?O abbreviations rather than spelled-out titles
			// THEN the c[a-z]o branch recognises them
			// [contact-discovery.ts — DECISION_MAKER_TITLE: c[a-z]o]
			expect(isDecisionMaker('CEO', undefined)).toBe(true)
			expect(isDecisionMaker('CTO', undefined)).toBe(true)
			expect(isDecisionMaker('COO', undefined)).toBe(true)
		})

		it('should match a VP only as a whole word', () => {
			// GIVEN a VP title and a word that merely contains "vp"
			// THEN the \bvp\b boundary matches the role but not the noise word
			// [contact-discovery.ts — DECISION_MAKER_TITLE: \bvp\b]
			expect(isDecisionMaker('VP Sales', undefined)).toBe(true)
			expect(isDecisionMaker('Revport Analyst', undefined)).toBe(false)
		})
	})

	describe('when seniority names an owner or founder tier', () => {
		it('should flag owner and founder seniorities regardless of title', () => {
			// GIVEN Hunter seniorities other than 'executive'
			// THEN the owner/founder alternatives are honoured too
			// [contact-discovery.ts — /executive|owner|founder/i on seniority]
			expect(isDecisionMaker(undefined, 'owner')).toBe(true)
			expect(isDecisionMaker(undefined, 'founder')).toBe(true)
		})
	})

	describe('when a non-leadership title embeds a keyword as a substring', () => {
		it('should still flag it — the title match is substring, not word-bounded', () => {
			// GIVEN an individual-contributor title that embeds "head"
			// THEN it matches anyway, documenting that DECISION_MAKER_TITLE is
			// deliberately loose (only \bvp\b is boundary-guarded). A future
			// tighten would change this expectation on purpose.
			// [contact-discovery.ts — DECISION_MAKER_TITLE has no \b around 'head']
			expect(isDecisionMaker('Headcount Analyst', undefined)).toBe(true)
		})
	})

	describe('when neither signal is present', () => {
		it('should not flag an individual contributor', () => {
			// GIVEN a junior role with no leadership title
			// THEN the person is not a decision-maker
			expect(isDecisionMaker('Sales Associate', 'junior')).toBe(false)
		})

		it('should not flag when both signals are absent', () => {
			// GIVEN no role and no seniority (both undefined)
			// THEN there is nothing to match on
			// [contact-discovery.ts — both guards fall through to false]
			expect(isDecisionMaker(undefined, undefined)).toBe(false)
		})
	})
})

describe('compareContacts', () => {
	describe('when one contact is a decision-maker', () => {
		it('should sort the decision-maker first', () => {
			// GIVEN a decision-maker and a non-decision-maker
			const dm = contact({ is_decision_maker: true })
			const other = contact({ is_decision_maker: false })
			// THEN the decision-maker sorts ahead
			expect([other, dm].sort(compareContacts)[0]).toBe(dm)
		})
	})

	describe('when both share decision-maker status', () => {
		it('should rank a deliverable address above a catch-all one', () => {
			// GIVEN equal decision-maker status but differing verdicts
			const good = contact({ verification: 'deliverable' })
			const catchAll = contact({ verification: 'catch_all' })
			// THEN the deliverable address ranks first
			expect([catchAll, good].sort(compareContacts)[0]).toBe(good)
		})

		it('should rank a risky address above an unknown one', () => {
			// GIVEN two mid-ladder verdicts (risky beats unknown)
			// THEN the more-trustworthy verdict ranks first
			// [contact-discovery.ts — VERDICT_RANK: risky 1 < unknown 3]
			const risky = contact({ verification: 'risky' })
			const unknown = contact({ verification: 'unknown' })
			expect([unknown, risky].sort(compareContacts)[0]).toBe(risky)
		})

		it('should break a verdict tie by higher confidence', () => {
			// GIVEN identical verdicts but differing confidence
			const high = contact({ confidence: 90 })
			const low = contact({ confidence: 40 })
			// THEN the higher-confidence address ranks first
			expect([low, high].sort(compareContacts)[0]).toBe(high)
		})

		it('should treat a missing confidence as the lowest, behind any number', () => {
			// GIVEN one address with a confidence score and one without
			// THEN the scored address ranks ahead — undefined reads as 0
			// [contact-discovery.ts — (confidence ?? 0)]
			const scored = contact({ confidence: 50 })
			const unscored = contact({})
			expect([unscored, scored].sort(compareContacts)[0]).toBe(scored)
		})

		it('should rank a verified email ahead of a contact with no email channel', () => {
			// GIVEN a deliverable-email contact and one reachable only on social
			// THEN the email contact wins — a channel-less contact falls back to
			// the 'unknown' verdict, which ranks below 'deliverable'
			// [contact-discovery.ts — VERDICT_RANK[ea?.verification ?? 'unknown']]
			const withEmail = contact({ verification: 'deliverable' })
			const socialOnly: DiscoveredContact = {
				name: 'Social Only',
				is_decision_maker: false,
				channels: [{ kind: 'linkedin', value: 'https://linkedin.com/in/x' }],
			}
			expect([socialOnly, withEmail].sort(compareContacts)[0]).toBe(withEmail)
		})
	})
})

describe('emailChannel', () => {
	describe('when the contact has an email channel', () => {
		it('should return the email channel, ignoring social ones', () => {
			// GIVEN a contact with both a social and an email channel
			const c: DiscoveredContact = {
				name: 'Has Email',
				is_decision_maker: false,
				channels: [
					{ kind: 'linkedin', value: 'https://linkedin.com/in/x' },
					{ kind: 'email', value: 'x@acme.com', verification: 'deliverable' },
				],
			}
			// THEN the email channel is the one returned (the ranking signal)
			expect(emailChannel(c)?.value).toBe('x@acme.com')
		})
	})

	describe('when the contact has no email channel', () => {
		it('should return undefined', () => {
			// GIVEN a contact reachable only on social channels
			const c: DiscoveredContact = {
				name: 'No Email',
				is_decision_maker: false,
				channels: [{ kind: 'phone', value: '+34000000000' }],
			}
			// THEN there is no email channel to rank on
			expect(emailChannel(c)).toBeUndefined()
		})
	})
})

// ── Discover orchestration (integration) ──
// ContactDiscovery.discover writes an anchor research_runs row, resolves policy,
// and meters paid spend, so it needs real Postgres (`pnpm cli services up` + the
// research migrations) wired to the StubEnrichmentProvider / StubEmailVerifier /
// MxResolver layers. Scaffolded as todo so the acceptance-criteria branches stay
// visible — each maps to a bullet in issue #140. Wire fixtures in the
// integration harness.
describe('ContactDiscovery.discover (integration)', () => {
	it.todo(
		'should return ranked verified contacts on the happy path, decision-makers first (stub people have no email → exercises guess + verify)',
	)
	it.todo(
		'should mark every address undeliverable and drop email channels when the domain has no MX (mxOutcome=no_mx)',
	)
	it.todo(
		'should still return a contact reachable only on social channels when its guessed email is undeliverable',
	)
	it.todo(
		'should reuse the vendor verdict without a paid verify call when person.email is already verified',
	)
	it.todo(
		'should fall back to an unknown verdict (not fail the run) when the verifier raises ProviderError',
	)
	it.todo(
		'should return no_reliable_contact when enrichment fails terminally and yields no people',
	)
	it.todo(
		'should return budget_exceeded when the per-call budget is exhausted before discovery completes',
	)
	it.todo(
		'should never return an undeliverable-only contact — the email channel is filtered and a person with no other channel is dropped',
	)
})
