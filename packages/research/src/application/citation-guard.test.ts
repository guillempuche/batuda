import { describe, expect, it } from 'vitest'

import { validateFindingCitations } from './citation-guard'

// Only this one URL was actually fetched by the run.
const isGrounded = (id: string) => id === 'https://acme.es'

describe('validateFindingCitations', () => {
	describe('when a citation names an un-fetched source', () => {
		it('should drop the invented citation and keep the grounded one', () => {
			// GIVEN a descriptive finding citing one fetched and one invented source
			const findings = {
				contacts: [
					{
						name: 'Ada',
						citations: [
							{ source_id: 'https://acme.es' },
							{ source_id: 'web_search_2023_11_24_01' },
						],
					},
				],
			}

			// WHEN validated against the fetched sources
			const result = validateFindingCitations(findings, isGrounded)

			// THEN only the grounded citation survives, and the finding is kept
			const contacts = (
				result.findings as { contacts: Array<{ citations: unknown[] }> }
			).contacts
			expect(contacts[0]?.citations).toEqual([{ source_id: 'https://acme.es' }])
			expect(result.total).toBe(2)
			expect(result.kept).toBe(1)
		})
	})

	describe('when a descriptive finding loses every citation', () => {
		it('should keep the finding with an empty citations array', () => {
			// GIVEN a contact whose only citation is invented
			const findings = {
				contacts: [{ name: 'Ada', citations: [{ source_id: 'invented' }] }],
			}

			// WHEN validated
			const result = validateFindingCitations(findings, isGrounded)

			// THEN the contact stays, stripped of its citation (it is not a write)
			const contacts = (
				result.findings as {
					contacts: Array<{ name: string; citations: unknown[] }>
				}
			).contacts
			expect(contacts).toHaveLength(1)
			expect(contacts[0]?.name).toBe('Ada')
			expect(contacts[0]?.citations).toEqual([])
		})
	})

	describe('when a proposed update loses every citation', () => {
		it('should drop the whole proposed update', () => {
			// GIVEN two proposed updates, one grounded and one invented
			const findings = {
				proposed_updates: [
					{
						subject_id: 'c1',
						fields: {},
						citations: [{ source_id: 'https://acme.es' }],
					},
					{
						subject_id: 'c2',
						fields: {},
						citations: [{ source_id: 'invented' }],
					},
				],
			}

			// WHEN validated
			const result = validateFindingCitations(findings, isGrounded)

			// THEN the uncited proposal is gone; the cited one remains
			const proposals = (
				result.findings as { proposed_updates: Array<{ subject_id: string }> }
			).proposed_updates
			expect(proposals).toHaveLength(1)
			expect(proposals[0]?.subject_id).toBe('c1')
		})
	})

	describe('when citations are nested at several depths', () => {
		it('should validate them wherever they appear', () => {
			// GIVEN a company-enrichment shape with citations at multiple levels
			const findings = {
				enrichment: {
					citations: [{ source_id: 'https://acme.es' }, { source_id: 'x' }],
				},
				competitors: [{ name: 'Rival', citations: [{ source_id: 'x' }] }],
				proposed_updates: [
					{ subject_id: 'c1', citations: [{ source_id: 'https://acme.es' }] },
				],
			}

			// WHEN validated
			const result = validateFindingCitations(findings, isGrounded)

			// THEN each depth is filtered independently
			const f = result.findings as {
				enrichment: { citations: unknown[] }
				competitors: Array<{ citations: unknown[] }>
				proposed_updates: unknown[]
			}
			expect(f.enrichment.citations).toEqual([{ source_id: 'https://acme.es' }])
			expect(f.competitors[0]?.citations).toEqual([])
			expect(f.proposed_updates).toHaveLength(1)
			expect(result.total).toBe(4)
			expect(result.kept).toBe(2)
		})
	})

	describe('when a citation source_id is not a string', () => {
		it('should drop it even when everything else would be grounded', () => {
			// GIVEN malformed citations with a numeric and a missing source_id
			const findings = { contacts: [{ citations: [{ source_id: 123 }, {}] }] }

			// WHEN validated with an all-accepting predicate
			const result = validateFindingCitations(findings, () => true)

			// THEN both are dropped because neither carries a string source_id
			const contacts = (
				result.findings as { contacts: Array<{ citations: unknown[] }> }
			).contacts
			expect(contacts[0]?.citations).toEqual([])
			expect(result.kept).toBe(0)
		})
	})
})
