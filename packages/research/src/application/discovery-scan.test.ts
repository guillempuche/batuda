import { describe, expect, it } from 'vitest'

import {
	isDiscoveryScanEmpty,
	isRetryEligible,
	REFINE_HINT,
} from './discovery-scan'

describe('isRetryEligible', () => {
	describe('when the schema is an open-ended discovery scan', () => {
		it('should be true for prospect_scan_v1 and competitor_scan_v1', () => {
			// GIVEN the two open-ended scan schemas
			// WHEN checked for retry eligibility
			// THEN both qualify
			expect(isRetryEligible('prospect_scan_v1')).toBe(true)
			expect(isRetryEligible('competitor_scan_v1')).toBe(true)
		})
	})

	describe('when the schema is entity-anchored or freeform', () => {
		it('should be false — those are not open-ended scans', () => {
			// GIVEN the entity-grounded and freeform schemas
			// WHEN checked
			// THEN none qualify for the discovery retry
			expect(isRetryEligible('company_enrichment_v1')).toBe(false)
			expect(isRetryEligible('contact_discovery_v1')).toBe(false)
			expect(isRetryEligible('freeform')).toBe(false)
			expect(isRetryEligible('unknown_schema')).toBe(false)
		})
	})
})

describe('isDiscoveryScanEmpty', () => {
	describe('when a prospect scan has no prospects', () => {
		it('should be true for an empty array', () => {
			// GIVEN a prospect scan with an empty primary list
			const findings = { prospects: [] }

			// WHEN checked for emptiness
			// THEN it is empty
			expect(isDiscoveryScanEmpty('prospect_scan_v1', findings)).toBe(true)
		})

		it('should be true when the primary list is missing entirely', () => {
			// GIVEN findings without the prospects key
			const findings = { discovered_existing: [] }

			// WHEN checked
			// THEN a missing primary list counts as empty
			expect(isDiscoveryScanEmpty('prospect_scan_v1', findings)).toBe(true)
		})

		it('should be true for a non-object findings value', () => {
			// GIVEN malformed findings for a discovery schema
			// WHEN checked
			// THEN null / array / primitive all count as empty
			expect(isDiscoveryScanEmpty('prospect_scan_v1', null)).toBe(true)
			expect(isDiscoveryScanEmpty('prospect_scan_v1', [])).toBe(true)
			expect(isDiscoveryScanEmpty('prospect_scan_v1', 'nope')).toBe(true)
		})
	})

	describe('when a prospect scan found prospects', () => {
		it('should be false', () => {
			// GIVEN a prospect scan with at least one result
			const findings = { prospects: [{ name: 'Acme 3PL' }] }

			// WHEN checked
			// THEN it is not empty
			expect(isDiscoveryScanEmpty('prospect_scan_v1', findings)).toBe(false)
		})
	})

	describe('when a competitor scan is checked', () => {
		it('should read its own primary list (competitors)', () => {
			// GIVEN empty and non-empty competitor scans
			// WHEN checked
			// THEN the competitors list drives the verdict
			expect(
				isDiscoveryScanEmpty('competitor_scan_v1', { competitors: [] }),
			).toBe(true)
			expect(
				isDiscoveryScanEmpty('competitor_scan_v1', {
					competitors: [{ name: 'Rival Co' }],
				}),
			).toBe(false)
		})
	})

	describe('when the schema is not a discovery scan', () => {
		it('should always be false, even with empty-looking findings', () => {
			// GIVEN a non-discovery schema with empty findings
			// WHEN checked
			// THEN emptiness is not this helper's concern → false
			expect(isDiscoveryScanEmpty('company_enrichment_v1', {})).toBe(false)
			expect(isDiscoveryScanEmpty('freeform', null)).toBe(false)
			expect(
				isDiscoveryScanEmpty('contact_discovery_v1', { contacts: [] }),
			).toBe(false)
		})
	})
})

describe('REFINE_HINT', () => {
	describe('when steering a refined retry', () => {
		it('should push toward directories and forbid placeholder site: filters', () => {
			// GIVEN the refinement hint appended on an empty retry
			// WHEN inspected
			// THEN it names authoritative sources and bans placeholder filters
			expect(REFINE_HINT).toMatch(/director/i)
			expect(REFINE_HINT).toMatch(/registr/i)
			expect(REFINE_HINT).toMatch(/placeholder site:/i)
		})
	})
})
