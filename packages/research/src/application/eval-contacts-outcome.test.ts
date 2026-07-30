import { describe, expect, it } from 'vitest'

import type { DiscoverContactsOutcome } from './contact-discovery'
import { outcomeFromContactRun } from './eval-contacts-outcome'

describe('outcomeFromContactRun', () => {
	describe('when the run returned ranked contacts', () => {
		it('should carry each contact and mark a deliverable email', () => {
			// GIVEN an ok outcome with a deliverable email + a social channel
			const discover: DiscoverContactsOutcome = {
				status: 'ok',
				researchId: 'r1',
				contacts: [
					{
						name: 'Ada Lovelace',
						role: 'CEO',
						buying_role: 'economic_buyer',
						channels: [
							{
								kind: 'email',
								value: 'ada@acme.example',
								verification: 'deliverable',
								is_primary: true,
							},
							{ kind: 'linkedin', value: 'https://linkedin.com/in/ada' },
						],
					},
				],
			}
			// WHEN adapted with the run's paid spend
			const outcome = outcomeFromContactRun(discover, { spendCents: 11 })
			// THEN the contact and its deliverable email land on the scorer's shape
			expect(outcome.status).toBe('ok')
			expect(outcome.spendCents).toBe(11)
			expect(outcome.contacts).toHaveLength(1)
			expect(outcome.contacts[0]?.isDecisionMaker).toBe(true)
			expect(outcome.contacts[0]?.email).toEqual({
				value: 'ada@acme.example',
				deliverable: true,
			})
		})

		it('should mark a non-deliverable verdict as not deliverable', () => {
			// GIVEN an email the verifier only rated risky
			const discover: DiscoverContactsOutcome = {
				status: 'ok',
				researchId: 'r1',
				contacts: [
					{
						name: 'Bo Jones',
						buying_role: null,
						channels: [
							{
								kind: 'email',
								value: 'bo@acme.example',
								verification: 'risky',
								is_primary: true,
							},
						],
					},
				],
			}
			// THEN only a strict 'deliverable' verdict counts as deliverable
			const outcome = outcomeFromContactRun(discover, { spendCents: 5 })
			expect(outcome.contacts[0]?.email).toEqual({
				value: 'bo@acme.example',
				deliverable: false,
			})
		})

		it('should leave the email undefined for a contact reachable only on social', () => {
			// GIVEN a contact with no email channel
			const discover: DiscoverContactsOutcome = {
				status: 'ok',
				researchId: 'r1',
				contacts: [
					{
						name: 'Cy Reach',
						buying_role: null,
						channels: [{ kind: 'linkedin', value: 'https://x' }],
					},
				],
			}
			// THEN there is no email to score
			const outcome = outcomeFromContactRun(discover, { spendCents: 0 })
			expect(outcome.contacts[0]?.email).toBeUndefined()
		})
	})

	describe('when the run found nobody', () => {
		it('should carry no contacts but keep the spend', () => {
			// GIVEN a terminal no_reliable_contact outcome (still cost something)
			const discover: DiscoverContactsOutcome = {
				status: 'no_reliable_contact',
				researchId: 'r1',
			}
			// THEN the run scores as empty with its spend preserved
			const outcome = outcomeFromContactRun(discover, { spendCents: 6 })
			expect(outcome.status).toBe('no_reliable_contact')
			expect(outcome.contacts).toEqual([])
			expect(outcome.spendCents).toBe(6)
		})
	})
})
