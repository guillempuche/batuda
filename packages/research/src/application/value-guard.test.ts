import { describe, expect, it } from 'vitest'

import { verifyProposalProvenance } from './value-guard'

const proposals = (findings: unknown): Array<{ subject_id: string }> =>
	(findings as { proposed_updates: Array<{ subject_id: string }> })
		.proposed_updates

describe('verifyProposalProvenance', () => {
	describe('when a proposed value appears in the evidence', () => {
		it('should keep the proposal, tolerating different formatting', () => {
			// GIVEN a scraped page that mentions the phone (differently punctuated)
			// and the email
			const corpus = 'Contact us at 404.555.0198 or sales@acme.es'
			const findings = {
				proposed_updates: [
					{
						subject_id: 'c1',
						fields: { phone: '(404) 555-0198', email: 'sales@acme.es' },
					},
				],
			}

			// WHEN checked
			const result = verifyProposalProvenance(findings, corpus)

			// THEN the proposal survives (digits + email both match)
			expect(proposals(result.findings)).toHaveLength(1)
			expect(result.droppedProposals).toBe(0)
		})
	})

	describe('when a proposed value appears nowhere in the evidence', () => {
		it('should drop the whole proposal', () => {
			// GIVEN a corpus that never mentions the invented phone
			const corpus = 'Acme is a logistics company based in Barcelona.'
			const findings = {
				proposed_updates: [
					{ subject_id: 'c1', fields: { phone: '(404) 555-0198' } },
				],
			}

			// WHEN checked
			const result = verifyProposalProvenance(findings, corpus)

			// THEN the fabricated CRM write is gone
			expect(proposals(result.findings)).toHaveLength(0)
			expect(result.droppedProposals).toBe(1)
		})
	})

	describe('when an invented email is proposed', () => {
		it('should drop it even though a real email exists elsewhere', () => {
			// GIVEN the wrong-domain fabrication class from the prod bug
			const corpus = 'Reach the team at hello@acme.es'
			const findings = {
				proposed_updates: [
					{
						subject_id: 'c1',
						fields: { email: 'ceo@greenglobalshipping.com' },
					},
				],
			}

			// WHEN checked
			const result = verifyProposalProvenance(findings, corpus)

			// THEN it is dropped
			expect(result.droppedProposals).toBe(1)
		})
	})

	describe('when a proposal only carries fuzzy free-text fields', () => {
		it('should keep it — those are not checkable', () => {
			// GIVEN a proposal with only free text the guard cannot confirm or refute
			const corpus = 'Some unrelated text.'
			const findings = {
				proposed_updates: [
					{
						subject_id: 'c1',
						fields: { industry: 'logistics', size_range: '50-200' },
					},
				],
			}

			// WHEN checked
			const result = verifyProposalProvenance(findings, corpus)

			// THEN it survives (fuzzy fields are left alone)
			expect(proposals(result.findings)).toHaveLength(1)
			expect(result.droppedProposals).toBe(0)
		})
	})

	describe('when several proposals mix supported and invented values', () => {
		it('should drop only the unsupported ones', () => {
			// GIVEN a supported phone, an invented email, and a fuzzy-only proposal
			const corpus = 'Phone: 936 123 456. Email: info@acme.es'
			const findings = {
				proposed_updates: [
					{ subject_id: 'a', fields: { phone: '936123456' } },
					{ subject_id: 'b', fields: { email: 'fake@nowhere.io' } },
					{ subject_id: 'c', fields: { notes: 'friendly' } },
				],
			}

			// WHEN checked
			const result = verifyProposalProvenance(findings, corpus)

			// THEN only the invented one is dropped
			expect(proposals(result.findings).map(p => p.subject_id)).toEqual([
				'a',
				'c',
			])
			expect(result.droppedProposals).toBe(1)
		})
	})

	describe('when a short digit run (like a year) is the only value', () => {
		it('should keep it — short numbers are not treated as checkable ids', () => {
			// GIVEN a founded-year that is not a phone/tax-id-length number
			const corpus = 'No numbers of interest here.'
			const findings = {
				proposed_updates: [
					{ subject_id: 'c1', fields: { foundedYear: '2005' } },
				],
			}

			// WHEN checked
			const result = verifyProposalProvenance(findings, corpus)

			// THEN it survives (a 4-digit year is not checked)
			expect(result.droppedProposals).toBe(0)
		})
	})

	describe('when findings carry no proposed_updates', () => {
		it('should return them unchanged', () => {
			// GIVEN descriptive-only findings
			const findings = { contacts: [{ name: 'Ada', email: 'ada@x.io' }] }

			// WHEN checked
			const result = verifyProposalProvenance(findings, 'anything')

			// THEN nothing is touched
			expect(result.findings).toEqual(findings)
			expect(result.droppedProposals).toBe(0)
		})
	})
})
