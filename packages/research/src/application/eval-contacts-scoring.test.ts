import { describe, expect, it } from 'vitest'

import {
	type ContactGoldenExpectation,
	type ContactRunOutcome,
	type GoldenContact,
	type OutcomeContact,
	scoreContactRun,
	summarizeContactScores,
} from './eval-contacts-scoring'

const golden = (
	expectedContacts: ReadonlyArray<GoldenContact>,
): ContactGoldenExpectation => ({
	id: 'acme',
	companyName: 'Acme SL',
	domain: 'acme.example',
	expectedContacts,
})

const outcome = (over: Partial<ContactRunOutcome>): ContactRunOutcome => ({
	status: 'ok',
	contacts: [],
	spendCents: 0,
	...over,
})

const returned = (
	name: string,
	opts: {
		role?: string
		dm?: boolean
		email?: string
		deliverable?: boolean
	} = {},
): OutcomeContact => ({
	name,
	role: opts.role,
	isDecisionMaker: opts.dm ?? false,
	email:
		opts.email !== undefined
			? { value: opts.email, deliverable: opts.deliverable ?? false }
			: undefined,
})

describe('scoreContactRun', () => {
	describe('contact recall', () => {
		it('should match by name despite accents and extra middle names', () => {
			// GIVEN a golden "María García" and a fuller returned record
			const score = scoreContactRun(
				golden([{ name: 'María García' }]),
				outcome({ contacts: [returned('Maria Jose Garcia Lopez')] }),
			)
			// THEN the accent-folded subset-token match counts it as found
			expect(score.contactsExpected).toBe(1)
			expect(score.contactsMatched).toBe(1)
		})

		it('should not match a different person who only shares a first name', () => {
			// GIVEN a returned contact sharing only the given name
			const score = scoreContactRun(
				golden([{ name: 'Maria Garcia' }]),
				outcome({ contacts: [returned('Maria Lopez')] }),
			)
			// THEN it is not counted — a shared first name is not the same person
			expect(score.contactsMatched).toBe(0)
		})

		it('should not match a first-name-only return against a full golden name', () => {
			// GIVEN a return with just one name token
			const score = scoreContactRun(
				golden([{ name: 'Maria Garcia' }]),
				outcome({ contacts: [returned('Maria')] }),
			)
			// THEN a lone token is too weak to confirm the person
			expect(score.contactsMatched).toBe(0)
		})
	})

	describe('decision-maker recall', () => {
		it('should count only golden contacts whose role marks a decision-maker', () => {
			// GIVEN a CEO (decision-maker) and a sales associate (not)
			const score = scoreContactRun(
				golden([
					{ name: 'Ada Lovelace', role: 'CEO' },
					{ name: 'Bo Jones', role: 'Sales Associate' },
				]),
				outcome({ contacts: [returned('Ada Lovelace')] }),
			)
			// THEN only the CEO is a decision-maker, and it was found
			expect(score.decisionMakersExpected).toBe(1)
			expect(score.decisionMakersMatched).toBe(1)
		})
	})

	describe('email precision', () => {
		it('should count a deliverable email matching the golden address as correct', () => {
			// GIVEN a deliverable email equal to the golden one (case-insensitively)
			const score = scoreContactRun(
				golden([{ name: 'Ada Lovelace', email: 'ada@acme.example' }]),
				outcome({
					contacts: [
						returned('Ada Lovelace', {
							email: 'ADA@acme.example',
							deliverable: true,
						}),
					],
				}),
			)
			// THEN it lands in both the precision denominator and numerator
			expect(score.emailDeliverableReturned).toBe(1)
			expect(score.emailDeliverableCorrect).toBe(1)
		})

		it('should count a deliverable email that does not match as a wrong assertion', () => {
			// GIVEN a deliverable email that differs from the golden address
			const score = scoreContactRun(
				golden([{ name: 'Ada Lovelace', email: 'ada@acme.example' }]),
				outcome({
					contacts: [
						returned('Ada Lovelace', {
							email: 'wrong@acme.example',
							deliverable: true,
						}),
					],
				}),
			)
			// THEN it counts against precision (denominator up, numerator flat)
			expect(score.emailDeliverableReturned).toBe(1)
			expect(score.emailDeliverableCorrect).toBe(0)
		})

		it('should ignore a non-deliverable email — the pipeline never asserted it', () => {
			// GIVEN an email the verifier did not confirm deliverable
			const score = scoreContactRun(
				golden([{ name: 'Ada Lovelace', email: 'ada@acme.example' }]),
				outcome({
					contacts: [
						returned('Ada Lovelace', {
							email: 'ada@acme.example',
							deliverable: false,
						}),
					],
				}),
			)
			// THEN it is out of the precision measure entirely
			expect(score.emailDeliverableReturned).toBe(0)
		})
	})

	describe('deliverable count and spend', () => {
		it('should count every deliverable-email contact and carry the run spend', () => {
			// GIVEN two deliverable contacts and 11¢ of paid spend
			const score = scoreContactRun(
				golden([{ name: 'Ada Lovelace' }]),
				outcome({
					spendCents: 11,
					contacts: [
						returned('Ada Lovelace', {
							email: 'a@acme.example',
							deliverable: true,
						}),
						returned('Someone Else', {
							email: 'b@acme.example',
							deliverable: true,
						}),
					],
				}),
			)
			// THEN both count toward cost-per-verified, and the spend rides along
			expect(score.deliverableReturned).toBe(2)
			expect(score.spendCents).toBe(11)
		})
	})

	describe('when the run found nobody', () => {
		it('should mark the run empty and match no contacts', () => {
			// GIVEN a terminal no_reliable_contact outcome
			const score = scoreContactRun(
				golden([{ name: 'Ada Lovelace' }]),
				outcome({ status: 'no_reliable_contact' }),
			)
			// THEN it is empty and recovers nobody
			expect(score.empty).toBe(true)
			expect(score.contactsMatched).toBe(0)
		})
	})
})

describe('summarizeContactScores', () => {
	describe('when there are no scores', () => {
		it('should return null rates rather than dividing by zero', () => {
			// GIVEN an empty batch
			const summary = summarizeContactScores([])
			// THEN the ratio metrics are null and the empty rate is 0
			expect(summary.contactRecall).toBeNull()
			expect(summary.costPerVerifiedContact).toBeNull()
			expect(summary.emptyRate).toBe(0)
		})
	})

	describe('when runs are aggregated', () => {
		it('should micro-average recall and divide spend by deliverable contacts', () => {
			// GIVEN one run that found 1 of 2 golden contacts, 1 deliverable, 12¢ spent
			const score = scoreContactRun(
				golden([{ name: 'Ada Lovelace' }, { name: 'Bo Jones' }]),
				outcome({
					spendCents: 12,
					contacts: [
						returned('Ada Lovelace', {
							email: 'a@acme.example',
							deliverable: true,
						}),
					],
				}),
			)
			const summary = summarizeContactScores([score])
			// THEN recall is 1/2 and cost is 12¢ ÷ 1 deliverable
			expect(summary.contactRecall).toBe(0.5)
			expect(summary.costPerVerifiedContact).toBe(12)
			expect(summary.emptyRate).toBe(0)
		})
	})
})
