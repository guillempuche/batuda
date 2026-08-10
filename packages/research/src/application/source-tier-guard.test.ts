import { describe, expect, it } from 'vitest'

import {
	AUTO_APPLY_CONFIDENCE_FLOOR,
	enforceSourceTier,
	THIRD_PARTY_CONFIDENCE_CAP,
} from './source-tier-guard'

interface SourcedView {
	value: unknown
	confidence?: unknown
}
interface EnrichmentView {
	size_range: SourcedView
	location: SourcedView
	email: SourcedView
}
const enrichment = (findings: unknown): EnrichmentView =>
	(findings as { enrichment: EnrichmentView }).enrichment

const TARGETS = ['acme.com']

describe('AUTO_APPLY_CONFIDENCE_FLOOR', () => {
	it('should sit above the third-party cap so a capped value never auto-applies', () => {
		// GIVEN the cap applied to outside estimates — THEN the floor clears it
		expect(AUTO_APPLY_CONFIDENCE_FLOOR).toBeGreaterThan(
			THIRD_PARTY_CONFIDENCE_CAP,
		)
	})
})

describe('enforceSourceTier', () => {
	describe("when a value is cited to the target's own domain", () => {
		it('should leave its confidence untouched', () => {
			// GIVEN a size value the company states on its own site
			const findings = {
				enrichment: {
					size_range: {
						value: '51-200',
						source_id: 'https://acme.com/about',
						confidence: 0.9,
					},
				},
			}

			// WHEN tiered against the target host
			const result = enforceSourceTier(findings, TARGETS)

			// THEN first-party confidence stands
			expect(enrichment(result.findings).size_range).toEqual(
				findings.enrichment.size_range,
			)
			expect(result.capped).toBe(0)
		})

		it('should treat a subdomain of the target as first-party', () => {
			// GIVEN a value from a subdomain of the company's site
			const findings = {
				enrichment: {
					location: {
						value: 'Chicago, IL',
						source_id: 'https://careers.acme.com',
						confidence: 0.95,
					},
				},
			}

			// WHEN tiered
			const result = enforceSourceTier(findings, TARGETS)

			// THEN kept
			expect(enrichment(result.findings).location).toEqual(
				findings.enrichment.location,
			)
			expect(result.capped).toBe(0)
		})
	})

	describe('when a value is cited to a third-party aggregator', () => {
		it('should cap a high confidence down to medium', () => {
			// GIVEN a headcount an aggregator estimated
			const findings = {
				enrichment: {
					size_range: {
						value: '501-1000',
						source_id: 'https://www.datanyze.com/companies/acme',
						confidence: 0.95,
					},
				},
			}

			// WHEN tiered
			const result = enforceSourceTier(findings, TARGETS)

			// THEN its confidence is held to the third-party cap, value untouched
			const size = enrichment(result.findings).size_range
			expect(size.value).toBe('501-1000')
			expect(size.confidence).toBe(THIRD_PARTY_CONFIDENCE_CAP)
			expect(result.capped).toBe(1)
		})

		it('should set a null confidence to the cap', () => {
			// GIVEN an aggregator value with no confidence
			const findings = {
				enrichment: {
					size_range: {
						value: '501-1000',
						source_id: 'https://zoominfo.com/c/acme',
						confidence: null,
					},
				},
			}

			// WHEN tiered
			const result = enforceSourceTier(findings, TARGETS)

			// THEN it is stamped at the cap
			expect(enrichment(result.findings).size_range.confidence).toBe(
				THIRD_PARTY_CONFIDENCE_CAP,
			)
			expect(result.capped).toBe(1)
		})

		it('should not raise an already-low third-party confidence', () => {
			// GIVEN an aggregator value already below the cap
			const findings = {
				enrichment: {
					size_range: {
						value: '501-1000',
						source_id: 'https://zoominfo.com/c/acme',
						confidence: 0.3,
					},
				},
			}

			// WHEN tiered
			const result = enforceSourceTier(findings, TARGETS)

			// THEN it is left as-is (the cap is a ceiling, not a floor)
			expect(enrichment(result.findings).size_range.confidence).toBe(0.3)
			expect(result.capped).toBe(0)
		})
	})

	describe('when a value is cited to a page the run already holds', () => {
		it('should keep its confidence — an internal id is not an outside host', () => {
			// GIVEN the mailbox harvested off the company's own contact page, which is
			// cited to our source id for that page rather than to its URL
			const findings = {
				enrichment: {
					email: {
						value: 'info@acme.com',
						source_id: 'src_1f7b0e8ff733b5d2',
						confidence: 1,
					},
				},
			}

			// WHEN tiered against the target host
			const result = enforceSourceTier(findings, TARGETS)

			// THEN it is not read as a third-party host and keeps the full confidence
			// it was harvested with
			expect(enrichment(result.findings).email.confidence).toBe(1)
			expect(result.capped).toBe(0)
		})
	})

	describe('when the run has no single target', () => {
		it('should be a no-op for an empty target list (a discovery scan)', () => {
			// GIVEN findings from a scan with no anchored company
			const findings = {
				enrichment: {
					size_range: {
						value: '501-1000',
						source_id: 'https://datanyze.com/x',
						confidence: 0.95,
					},
				},
			}

			// WHEN tiered with no targets
			const result = enforceSourceTier(findings, [])

			// THEN nothing is capped
			expect(enrichment(result.findings).size_range.confidence).toBe(0.95)
			expect(result.capped).toBe(0)
		})
	})

	describe('when a value sits in a proposed update', () => {
		// The shape the pipeline stores: one address written twice — into the company
		// profile, and into the change a person is offered to accept.
		const withProposal = (email: SourcedView & { source_id: string }) => ({
			enrichment: { email },
			proposed_updates: [
				{
					subject_table: 'companies',
					subject_id: 'c1',
					expected_version: 3,
					fields: { email },
					reason: 'Get in touch: info@acme.com',
					citations: [{ source_id: email.source_id, confidence: 1 }],
				},
			],
		})
		const proposal = (findings: unknown) =>
			(findings as ReturnType<typeof withProposal>).proposed_updates[0]

		it('should cap a third-party one, since a proposal is what reaches the record', () => {
			// GIVEN an aggregator-sourced address offered as a change to accept
			const findings = withProposal({
				value: 'hello@acme.com',
				source_id: 'https://www.datanyze.com/companies/acme',
				confidence: 0.9,
			})

			// WHEN tiered
			const result = enforceSourceTier(findings, TARGETS)

			// THEN the offer carries the held-back confidence, not the model's claim
			expect(proposal(result.findings)?.fields.email.confidence).toBe(
				THIRD_PARTY_CONFIDENCE_CAP,
			)
		})

		it('should keep one cited to a page the run already holds', () => {
			// GIVEN the mailbox harvested off the company's own contact page, cited by
			// our source id for that page
			const findings = withProposal({
				value: 'info@acme.com',
				source_id: 'src_1f7b0e8ff733b5d2',
				confidence: 1,
			})

			// WHEN tiered — THEN full confidence stands; an internal id is not an
			// outside host
			const result = enforceSourceTier(findings, TARGETS)
			expect(proposal(result.findings)?.fields.email.confidence).toBe(1)
			expect(result.capped).toBe(0)
		})

		it('should record one confidence for one fact, not two', () => {
			// GIVEN the same aggregator-sourced address in the profile and the offer
			const findings = withProposal({
				value: 'hello@acme.com',
				source_id: 'https://www.datanyze.com/companies/acme',
				confidence: 0.9,
			})

			// WHEN tiered
			const result = enforceSourceTier(findings, TARGETS)

			// THEN both copies read the same, so nothing downstream can pick the
			// friendlier number
			expect(enrichment(result.findings).email.confidence).toBe(
				proposal(result.findings)?.fields.email.confidence,
			)
			expect(result.capped).toBe(2)
		})

		it('should leave the citation list beside the fields alone', () => {
			// GIVEN a proposal whose citations name the aggregator the value came from
			const findings = withProposal({
				value: 'hello@acme.com',
				source_id: 'https://www.datanyze.com/companies/acme',
				confidence: 0.9,
			})

			// WHEN tiered — THEN only the fields are graded; a citation records where a
			// claim came from and is not itself a claim
			const result = enforceSourceTier(findings, TARGETS)
			expect(proposal(result.findings)?.citations).toEqual(
				findings.proposed_updates[0]?.citations,
			)
		})

		it('should leave an entry that carries no provenance', () => {
			// GIVEN a proposal field that is a bare value with no source, quote, or
			// confidence — the freeform content the walk must not mistake for a field
			const findings = {
				enrichment: {},
				proposed_updates: [
					{ subject_id: 'c1', fields: { note: { value: 'call reception' } } },
				],
			}

			// WHEN tiered — THEN it is untouched, and nothing is counted as capped
			const result = enforceSourceTier(findings, TARGETS)
			expect(result.findings).toEqual(findings)
			expect(result.capped).toBe(0)
		})
	})

	describe('when the findings hold a block-level citation array', () => {
		it('should leave it alone', () => {
			// GIVEN a citation list whose entries carry a source and a confidence, so
			// each one could pass for a field
			const findings = {
				enrichment: {},
				citations: [
					{ value: 'x', source_id: 'https://datanyze.com/x', confidence: 0.9 },
				],
			}

			// WHEN tiered — THEN the list stands; a citation is provenance, not a value
			const result = enforceSourceTier(findings, TARGETS)
			expect(result.capped).toBe(0)
			expect((result.findings as typeof findings).citations).toEqual(
				findings.citations,
			)
		})
	})
})
