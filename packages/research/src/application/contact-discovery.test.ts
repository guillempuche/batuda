import { Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'

import { decidesPurchase } from '@batuda/domain'

import { BudgetExceeded, ProviderError } from '../domain/errors'
import { EnrichmentResult, type VerificationVerdict } from '../domain/types'
import {
	buyingRoleFromTitle,
	compareContacts,
	type DiscoveredContact,
	dedupePeople,
	emailChannel,
	runEnrichmentChain,
} from './contact-discovery'

const contact = (over: {
	buying_role?: string | null
	verification?: VerificationVerdict
	confidence?: number
}): DiscoveredContact => ({
	name: 'Test Person',
	buying_role: over.buying_role ?? null,
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

describe('buyingRoleFromTitle', () => {
	describe('when seniority marks the executive tier', () => {
		it('should flag an executive regardless of title', () => {
			// GIVEN Hunter seniority 'executive'
			// THEN the person counts as a decision-maker
			expect(decidesPurchase(buyingRoleFromTitle(undefined, 'executive'))).toBe(
				true,
			)
		})
	})

	describe('when the title names a leadership role', () => {
		it('should match director / chief / head / founder titles', () => {
			// GIVEN common decision-maker titles
			// THEN each is recognised
			expect(
				decidesPurchase(buyingRoleFromTitle('Managing Director', undefined)),
			).toBe(true)
			expect(
				decidesPurchase(
					buyingRoleFromTitle('Chief Financial Officer', undefined),
				),
			).toBe(true)
			expect(
				decidesPurchase(buyingRoleFromTitle('Head of Procurement', undefined)),
			).toBe(true)
			expect(decidesPurchase(buyingRoleFromTitle('Founder', undefined))).toBe(
				true,
			)
		})

		it('should match three-letter C-suite abbreviations', () => {
			// GIVEN bare C?O abbreviations rather than spelled-out titles
			// THEN the c[a-z]o branch recognises them
			// [contact-discovery.ts — DECISION_MAKER_TITLE: c[a-z]o]
			expect(decidesPurchase(buyingRoleFromTitle('CEO', undefined))).toBe(true)
			expect(decidesPurchase(buyingRoleFromTitle('CTO', undefined))).toBe(true)
			expect(decidesPurchase(buyingRoleFromTitle('COO', undefined))).toBe(true)
		})

		it('should match a VP only as a whole word', () => {
			// GIVEN a VP title and a word that merely contains "vp"
			// THEN the \bvp\b boundary matches the role but not the noise word
			// [contact-discovery.ts — DECISION_MAKER_TITLE: \bvp\b]
			expect(decidesPurchase(buyingRoleFromTitle('VP Sales', undefined))).toBe(
				true,
			)
			expect(
				decidesPurchase(buyingRoleFromTitle('Revport Analyst', undefined)),
			).toBe(false)
		})
	})

	describe('when seniority names an owner or founder tier', () => {
		it('should flag owner and founder seniorities regardless of title', () => {
			// GIVEN Hunter seniorities other than 'executive'
			// THEN the owner/founder alternatives are honoured too
			// [contact-discovery.ts — /executive|owner|founder/i on seniority]
			expect(decidesPurchase(buyingRoleFromTitle(undefined, 'owner'))).toBe(
				true,
			)
			expect(decidesPurchase(buyingRoleFromTitle(undefined, 'founder'))).toBe(
				true,
			)
		})
	})

	describe('when a non-leadership title embeds a keyword as a substring', () => {
		it('should still flag it — the title match is substring, not word-bounded', () => {
			// GIVEN an individual-contributor title that embeds "head"
			// THEN it matches anyway, documenting that DECISION_MAKER_TITLE is
			// deliberately loose (only \bvp\b is boundary-guarded). A future
			// tighten would change this expectation on purpose.
			// [contact-discovery.ts — DECISION_MAKER_TITLE has no \b around 'head']
			expect(
				decidesPurchase(buyingRoleFromTitle('Headcount Analyst', undefined)),
			).toBe(true)
		})
	})

	describe('when neither signal is present', () => {
		it('should not flag an individual contributor', () => {
			// GIVEN a junior role with no leadership title
			// THEN the person is not a decision-maker
			expect(
				decidesPurchase(buyingRoleFromTitle('Sales Associate', 'junior')),
			).toBe(false)
		})

		it('should not flag when both signals are absent', () => {
			// GIVEN no role and no seniority (both undefined)
			// THEN there is nothing to match on
			// [contact-discovery.ts — both guards fall through to false]
			expect(decidesPurchase(buyingRoleFromTitle(undefined, undefined))).toBe(
				false,
			)
		})
	})
})

describe('compareContacts', () => {
	describe('when one contact is a decision-maker', () => {
		it('should sort the decision-maker first', () => {
			// GIVEN a decision-maker and a non-decision-maker
			const dm = contact({ buying_role: 'economic_buyer' })
			const other = contact({ buying_role: null })
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
				buying_role: null,
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
				buying_role: null,
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
				buying_role: null,
				channels: [{ kind: 'phone', value: '+34000000000' }],
			}
			// THEN there is no email channel to rank on
			expect(emailChannel(c)).toBeUndefined()
		})
	})
})

// ── Enrichment waterfall (runEnrichmentChain + dedupePeople) ──

// A person as an enrichment vendor returns it — only the fields the waterfall
// reads. Wrapped into an EnrichmentResult by the attempt helpers below.
const somePerson = (
	firstName: string,
	lastName: string,
	email?: string,
): { firstName: string; lastName: string; email?: string } =>
	email === undefined ? { firstName, lastName } : { firstName, lastName, email }

// An attempt that returns people and records (in `calls`) that it ran, so a
// test can assert which vendors the waterfall actually reached.
const vendorReturns = (
	label: string,
	people: ReadonlyArray<{
		firstName: string
		lastName: string
		email?: string
	}>,
	calls: string[],
) => ({
	label,
	findPeople: () =>
		Effect.sync(() => {
			calls.push(label)
			return new EnrichmentResult({ people: [...people], units: people.length })
		}),
})

// An attempt that refuses because the vendor's own paid allowance is spent.
const vendorOutOfCredit = (label: string, calls: string[]) => ({
	label,
	findPeople: () =>
		Effect.suspend(() => {
			calls.push(label)
			return Effect.fail(
				new ProviderError({
					provider: label,
					message: 'quota',
					recoverable: false,
					quotaExhausted: true,
				}),
			)
		}),
})

// An attempt that fails the way a real provider outage does.
const vendorFails = (label: string, calls: string[]) => ({
	label,
	findPeople: () =>
		Effect.suspend(() => {
			calls.push(label)
			return Effect.fail(
				new ProviderError({
					provider: label,
					message: 'down',
					recoverable: false,
				}),
			)
		}),
})

const anInput = { domain: 'acme.example' }
const recordCharge =
	(charged: string[]) =>
	(label: string): Effect.Effect<void> =>
		Effect.sync(() => {
			charged.push(label)
		})

describe('runEnrichmentChain', () => {
	describe('when a vendor turns us away', () => {
		it('should say its credit ran out, not that nobody works there', async () => {
			// GIVEN the only vendor refuses because its paid allowance is spent
			const calls: string[] = []
			const outcome = await Effect.runPromise(
				runEnrichmentChain(
					{ attempts: [vendorOutOfCredit('hunter', calls)], mode: 'fallback' },
					anInput,
					recordCharge([]),
				),
			)

			// THEN the empty list carries the reason: an unpaid bill and a company
			// with nobody to find look identical without it
			expect(outcome.people).toEqual([])
			expect(outcome.quotaExhausted).toBe(true)
			expect(outcome.vendorFailed).toBe(false)
		})

		it('should tell an outage apart from an exhausted allowance', async () => {
			// GIVEN the only vendor is simply down
			const calls: string[] = []
			const outcome = await Effect.runPromise(
				runEnrichmentChain(
					{ attempts: [vendorFails('hunter', calls)], mode: 'fallback' },
					anInput,
					recordCharge([]),
				),
			)

			// THEN it reads as unreachable, which is worth retrying later, rather
			// than as a bill to pay
			expect(outcome.vendorFailed).toBe(true)
			expect(outcome.quotaExhausted).toBe(false)
		})
	})

	describe('when mode is fallback', () => {
		it('should stop at the first vendor that finds anyone', async () => {
			// GIVEN two vendors that both have people
			const calls: string[] = []
			const charged: string[] = []
			const outcome = await Effect.runPromise(
				runEnrichmentChain(
					{
						attempts: [
							vendorReturns('hunter', [somePerson('Ada', 'One')], calls),
							vendorReturns('fullenrich', [somePerson('Bo', 'Two')], calls),
						],
						mode: 'fallback',
					},
					anInput,
					recordCharge(charged),
				),
			)
			// THEN only the first vendor ran, was billed, and shaped the result
			expect(calls).toEqual(['hunter'])
			expect(charged).toEqual(['hunter'])
			expect(outcome.people.map(p => p.firstName)).toEqual(['Ada'])
		})

		it('should advance to the next vendor when one finds nobody', async () => {
			// GIVEN the first vendor returns nobody
			const calls: string[] = []
			const charged: string[] = []
			const outcome = await Effect.runPromise(
				runEnrichmentChain(
					{
						attempts: [
							vendorReturns('hunter', [], calls),
							vendorReturns('fullenrich', [somePerson('Bo', 'Two')], calls),
						],
						mode: 'fallback',
					},
					anInput,
					recordCharge(charged),
				),
			)
			// THEN both vendors were billed (Hunter missed → FullEnrich) and the
			// second vendor's people came back
			expect(charged).toEqual(['hunter', 'fullenrich'])
			expect(outcome.people.map(p => p.firstName)).toEqual(['Bo'])
		})

		it('should bill and skip past a vendor that errors', async () => {
			// GIVEN the first vendor is down
			const calls: string[] = []
			const charged: string[] = []
			const outcome = await Effect.runPromise(
				runEnrichmentChain(
					{
						attempts: [
							vendorFails('hunter', calls),
							vendorReturns('fullenrich', [somePerson('Bo', 'Two')], calls),
						],
						mode: 'fallback',
					},
					anInput,
					recordCharge(charged),
				),
			)
			// THEN its error degrades to no people, so the next vendor still runs
			expect(calls).toEqual(['hunter', 'fullenrich'])
			expect(charged).toEqual(['hunter', 'fullenrich'])
			expect(outcome.people.map(p => p.firstName)).toEqual(['Bo'])
		})
	})

	describe('when mode is union', () => {
		it('should run and bill every vendor and merge their people', async () => {
			// GIVEN two vendors that each find a different person
			const calls: string[] = []
			const charged: string[] = []
			const outcome = await Effect.runPromise(
				runEnrichmentChain(
					{
						attempts: [
							vendorReturns('hunter', [somePerson('Ada', 'One')], calls),
							vendorReturns('fullenrich', [somePerson('Bo', 'Two')], calls),
						],
						mode: 'union',
					},
					anInput,
					recordCharge(charged),
				),
			)
			// THEN every vendor ran and was billed, and the union holds both people
			expect(charged).toEqual(['hunter', 'fullenrich'])
			expect(outcome.people.map(p => p.firstName).sort()).toEqual(['Ada', 'Bo'])
		})

		it('should collapse the same person found by two vendors, keeping the email', async () => {
			// GIVEN both vendors return the same person, only one with an email
			const outcome = await Effect.runPromise(
				runEnrichmentChain(
					{
						attempts: [
							vendorReturns('hunter', [somePerson('Ada', 'One')], []),
							vendorReturns(
								'fullenrich',
								[somePerson('Ada', 'One', 'ada@acme.example')],
								[],
							),
						],
						mode: 'union',
					},
					anInput,
					recordCharge([]),
				),
			)
			// THEN one entry survives, carrying the vendor-found address
			expect(outcome.people).toHaveLength(1)
			expect(outcome.people[0]?.email).toBe('ada@acme.example')
		})
	})

	describe('when the budget rejects the charge', () => {
		it('should abort before calling the vendor and surface the budget error', async () => {
			// GIVEN the per-run budget rejects the charge
			const calls: string[] = []
			const exit = await Effect.runPromiseExit(
				runEnrichmentChain(
					{
						attempts: [
							vendorReturns('hunter', [somePerson('Ada', 'One')], calls),
						],
						mode: 'fallback',
					},
					anInput,
					() =>
						Effect.fail(
							new BudgetExceeded({ tier: 'paid-run', needed: 6, remaining: 0 }),
						),
				),
			)
			// THEN the chain fails (the rail propagates) and the vendor never ran —
			// the charge is taken before the paid call
			expect(Exit.isFailure(exit)).toBe(true)
			expect(calls).toEqual([])
		})
	})
})

describe('dedupePeople', () => {
	describe('when the same person appears from two vendors', () => {
		it('should keep one entry and prefer the record that has an email', () => {
			// GIVEN a name-only record and an email-bearing one for the same person
			const merged = dedupePeople([
				somePerson('Ada', 'One'),
				somePerson('Ada', 'One', 'ada@acme.example'),
			])
			// THEN they collapse to one, keeping the address a vendor found
			expect(merged).toHaveLength(1)
			expect(merged[0]?.email).toBe('ada@acme.example')
		})

		it('should keep the first address when both records already have one', () => {
			// GIVEN two email-bearing records for the same person
			const merged = dedupePeople([
				somePerson('Ada', 'One', 'first@acme.example'),
				somePerson('Ada', 'One', 'second@acme.example'),
			])
			// THEN the first wins — there is nothing better to prefer
			expect(merged).toHaveLength(1)
			expect(merged[0]?.email).toBe('first@acme.example')
		})
	})

	describe('when the people are distinct', () => {
		it('should preserve every distinct person', () => {
			// GIVEN two different people
			const merged = dedupePeople([
				somePerson('Ada', 'One'),
				somePerson('Bo', 'Two'),
			])
			// THEN both survive the merge
			expect(merged).toHaveLength(2)
		})
	})

	describe('when a record carries no name', () => {
		it('should identify nameless people by email so they are not merged', () => {
			// GIVEN two nameless records with different emails
			const merged = dedupePeople([
				somePerson('', '', 'x@acme.example'),
				somePerson('', '', 'y@acme.example'),
			])
			// THEN the email fallback key keeps them distinct
			expect(merged).toHaveLength(2)
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
