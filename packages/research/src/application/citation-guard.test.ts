import { describe, expect, it } from 'vitest'

import {
	groundedCitationTest,
	validateFindingCitations,
} from './citation-guard'

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

	describe('when sources sit at several depths and shapes', () => {
		it('should judge a per-field wrapper, a block array, and a proposal each on its own', () => {
			// GIVEN a company-enrichment shape mixing per-field sources (the new
			// wrapper) with the block-level citation arrays competitors + proposals
			// still use
			const findings = {
				enrichment: {
					industry: { value: 'Retail', source_id: 'https://acme.es' },
					location: { value: 'Barcelona', source_id: 'x' },
				},
				competitors: [{ name: 'Rival', citations: [{ source_id: 'x' }] }],
				proposed_updates: [
					{
						subject_id: 'c1',
						fields: {},
						citations: [{ source_id: 'https://acme.es' }],
					},
				],
			}

			// WHEN validated
			const result = validateFindingCitations(findings, isGrounded)

			// THEN each is filtered independently: the grounded wrapper keeps its
			// source, the ungrounded wrapper keeps only its value, the invented
			// competitor citation is dropped, the grounded proposal survives
			const f = result.findings as {
				enrichment: { industry: unknown; location: unknown }
				competitors: Array<{ citations: unknown[] }>
				proposed_updates: unknown[]
			}
			expect(f.enrichment.industry).toEqual({
				value: 'Retail',
				source_id: 'https://acme.es',
			})
			expect(f.enrichment.location).toEqual({ value: 'Barcelona' })
			expect(f.competitors[0]?.citations).toEqual([])
			expect(f.proposed_updates).toHaveLength(1)
			expect(result.total).toBe(4)
			expect(result.kept).toBe(2)
		})
	})

	describe('when a per-field wrapper carries quote and confidence', () => {
		it('should keep them on a grounded field and drop them all on an ungrounded one', () => {
			// GIVEN two sourced fields — one citing the fetched page, one invented
			const findings = {
				enrichment: {
					industry: {
						value: 'Retail',
						source_id: 'https://acme.es',
						quote: 'a shop',
						confidence: 0.9,
					},
					region: { value: 'Catalonia', source_id: 'invented' },
				},
			}

			// WHEN validated against the one fetched source
			const result = validateFindingCitations(findings, isGrounded)

			// THEN the grounded field keeps its full provenance; the invented one
			// keeps only its value
			const f = result.findings as {
				enrichment: { industry: unknown; region: unknown }
			}
			expect(f.enrichment.industry).toEqual({
				value: 'Retail',
				source_id: 'https://acme.es',
				quote: 'a shop',
				confidence: 0.9,
			})
			expect(f.enrichment.region).toEqual({ value: 'Catalonia' })
			expect(result.total).toBe(2)
			expect(result.kept).toBe(1)
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

describe('groundedCitationTest', () => {
	// The run fetched one page on the target's own site.
	const grounded = groundedCitationTest([
		{ localRef: 'https://acme.es/about', sourceId: 'src_abc' },
	])

	describe('when a citation points at the fetched page or its site', () => {
		it('should keep an exact URL, the opaque source id, and tidied same-site forms', () => {
			// GIVEN citations that match the fetched page exactly or just its site
			// THEN each is accepted, so a model that tidied the URL is still credited
			expect(grounded('https://acme.es/about')).toBe(true) // exact page
			expect(grounded('src_abc')).toBe(true) // opaque source id
			expect(grounded('https://www.acme.es/about')).toBe(true) // www added
			expect(grounded('https://acme.es')).toBe(true) // homepage, not the page
			expect(grounded('acme.es')).toBe(true) // scheme dropped
		})
	})

	describe('when a citation points off the fetched site', () => {
		it('should reject an aggregator domain or a non-URL', () => {
			// GIVEN a citation to a domain the run never fetched, or to prose
			// THEN it is rejected, so fabricated / look-alike citations do not pass
			expect(grounded('https://directory.example.com/acme')).toBe(false)
			expect(grounded('made up text')).toBe(false)
		})
	})
})
