import { describe, expect, it } from 'vitest'

import {
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
}
const enrichment = (findings: unknown): EnrichmentView =>
	(findings as { enrichment: EnrichmentView }).enrichment

const TARGETS = ['acme.com']

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

	describe('when the shape holds subtrees that are not scalar fields', () => {
		it('should not walk into citations or proposed_updates', () => {
			// GIVEN a proposed-update blob whose fields could look field-ish
			const findings = {
				enrichment: {},
				proposed_updates: [
					{
						subject_id: 'c1',
						fields: {
							value: 'x',
							source_id: 'https://datanyze.com/x',
							confidence: 0.9,
						},
						citations: [{ source_id: 'https://datanyze.com/x' }],
					},
				],
			}

			// WHEN tiered
			const result = enforceSourceTier(findings, TARGETS)

			// THEN the freeform subtree is untouched
			expect(result.capped).toBe(0)
			expect(
				(result.findings as { proposed_updates: unknown[] }).proposed_updates,
			).toEqual(findings.proposed_updates)
		})
	})
})
