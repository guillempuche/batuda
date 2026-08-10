import { describe, expect, it } from 'vitest'

import {
	DISCOVERY_THIN_RESULT_COUNT,
	discoveryResultCount,
	emptyScanFindings,
	isDiscoveryScan,
	isDiscoveryScanEmpty,
	isDiscoveryScanThin,
	REFINE_HINT,
} from './discovery-scan'

// A list long enough that no thinness check reads it as short, whatever the
// threshold is set to.
const fullList = (field: string): Record<string, unknown> => ({
	[field]: Array.from({ length: DISCOVERY_THIN_RESULT_COUNT + 3 }, (_, i) => ({
		name: `Company ${i}`,
	})),
})

describe('isDiscoveryScan', () => {
	describe('when the schema is an open-ended discovery scan', () => {
		it('should be true for prospect_scan_v1 and competitor_scan_v1', () => {
			// GIVEN the two open-ended scan schemas
			// WHEN checked
			// THEN both qualify — a competitor scan is a scan exactly as a prospect
			// scan is, which is what the two hand-written lists once disagreed on
			expect(isDiscoveryScan('prospect_scan_v1')).toBe(true)
			expect(isDiscoveryScan('competitor_scan_v1')).toBe(true)
		})
	})

	describe('when the schema is entity-anchored or freeform', () => {
		it('should be false — those are not open-ended scans', () => {
			// GIVEN the entity-grounded and freeform schemas
			// WHEN checked
			// THEN none is a discovery scan
			expect(isDiscoveryScan('company_enrichment_v1')).toBe(false)
			expect(isDiscoveryScan('contact_discovery_v1')).toBe(false)
			expect(isDiscoveryScan('freeform')).toBe(false)
			expect(isDiscoveryScan('unknown_schema')).toBe(false)
		})
	})
})

describe('discoveryResultCount', () => {
	describe('when the schema is not a discovery scan', () => {
		it('should be null, however empty the findings look', () => {
			// GIVEN a non-discovery schema
			// WHEN counted
			// THEN there is no scan list to count — null, never 0, so a caller
			// cannot mistake "does not apply" for "found nothing"
			expect(discoveryResultCount('company_enrichment_v1', {})).toBeNull()
			expect(
				discoveryResultCount('contact_discovery_v1', { contacts: [] }),
			).toBeNull()
			expect(discoveryResultCount('freeform', null)).toBeNull()
		})
	})

	describe('when a scan carries its primary list', () => {
		it('should count its entries', () => {
			// GIVEN each scan schema with results in its own primary list
			// WHEN counted
			// THEN each reads its own field
			expect(
				discoveryResultCount('prospect_scan_v1', {
					prospects: [{ name: 'Acme 3PL' }, { name: 'Bolt Logistics' }],
				}),
			).toBe(2)
			expect(
				discoveryResultCount('competitor_scan_v1', {
					competitors: [{ name: 'Rival Co' }],
				}),
			).toBe(1)
		})

		it('should not count another scan schema’s list', () => {
			// GIVEN a competitor scan whose findings carry a prospects list instead
			// WHEN counted
			// THEN the field it does not own counts for nothing
			expect(
				discoveryResultCount('competitor_scan_v1', {
					prospects: [{ name: 'Acme 3PL' }],
				}),
			).toBe(0)
		})
	})

	describe('when the primary list is missing or unusable', () => {
		it('should be zero', () => {
			// GIVEN a scan whose list is absent, of the wrong type, or whose
			// findings are not an object at all
			// WHEN counted
			// THEN nothing countable is nothing found
			expect(
				discoveryResultCount('prospect_scan_v1', { discovered_existing: [] }),
			).toBe(0)
			expect(
				discoveryResultCount('prospect_scan_v1', { prospects: 'Acme 3PL' }),
			).toBe(0)
			expect(discoveryResultCount('prospect_scan_v1', null)).toBe(0)
			expect(discoveryResultCount('prospect_scan_v1', [])).toBe(0)
			expect(discoveryResultCount('prospect_scan_v1', 'nope')).toBe(0)
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
		it('should be false for even a single result', () => {
			// GIVEN a prospect scan with one result — thin, but not nothing
			const findings = { prospects: [{ name: 'Acme 3PL' }] }

			// WHEN checked
			// THEN it is not empty: a real result is never reported as nothing found
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

describe('isDiscoveryScanThin', () => {
	const listOf = (field: string, count: number): Record<string, unknown> => ({
		[field]: Array.from({ length: count }, (_, i) => ({ name: `Co ${i}` })),
	})

	describe('when a scan came back with fewer results than a list needs', () => {
		it('should be true one short of the threshold', () => {
			// GIVEN the reported run: a handful of companies where a list was asked
			// for, which used to finish as green as a full one
			const findings = listOf('prospects', DISCOVERY_THIN_RESULT_COUNT - 1)

			// WHEN checked for thinness
			// THEN it is thin
			expect(isDiscoveryScanThin('prospect_scan_v1', findings)).toBe(true)
		})

		it('should be true for a single result', () => {
			// GIVEN one company found
			// WHEN checked
			// THEN one result is as thin as a result gets while still being one
			expect(
				isDiscoveryScanThin('prospect_scan_v1', listOf('prospects', 1)),
			).toBe(true)
		})

		it('should be true when the scan found nothing at all', () => {
			// GIVEN an empty, missing, or unusable list
			// WHEN checked
			// THEN nothing found is the thinnest result there is
			expect(isDiscoveryScanThin('prospect_scan_v1', { prospects: [] })).toBe(
				true,
			)
			expect(isDiscoveryScanThin('competitor_scan_v1', {})).toBe(true)
			expect(isDiscoveryScanThin('prospect_scan_v1', null)).toBe(true)
		})
	})

	describe('when a scan came back with a full list', () => {
		it('should be false at exactly the threshold', () => {
			// GIVEN a scan holding exactly as many results as the threshold asks for
			const findings = listOf('prospects', DISCOVERY_THIN_RESULT_COUNT)

			// WHEN checked
			// THEN the threshold is the point at which a list stops being thin, so
			// this one is not flagged
			expect(isDiscoveryScanThin('prospect_scan_v1', findings)).toBe(false)
		})

		it('should be false well above it', () => {
			// GIVEN a scan with a long list
			// WHEN checked
			// THEN it is a list, not a lead or two
			expect(
				isDiscoveryScanThin('prospect_scan_v1', fullList('prospects')),
			).toBe(false)
		})
	})

	describe('when a competitor scan is checked', () => {
		it('should read its own primary list, exactly as a prospect scan does', () => {
			// GIVEN thin and full competitor scans
			// WHEN checked
			// THEN the competitors list drives the verdict, so a competitor scan is
			// graded like a prospect scan rather than escaping the check
			expect(
				isDiscoveryScanThin('competitor_scan_v1', listOf('competitors', 2)),
			).toBe(true)
			expect(
				isDiscoveryScanThin('competitor_scan_v1', fullList('competitors')),
			).toBe(false)
		})
	})

	describe('when the schema is not a discovery scan', () => {
		it('should always be false, however little it holds', () => {
			// GIVEN an enrichment or freeform run, which was never asked for a list
			// WHEN checked
			// THEN thinness is not this helper's concern → false
			expect(isDiscoveryScanThin('company_enrichment_v1', {})).toBe(false)
			expect(isDiscoveryScanThin('freeform', null)).toBe(false)
			expect(
				isDiscoveryScanThin('contact_discovery_v1', { contacts: [] }),
			).toBe(false)
		})
	})
})

describe('REFINE_HINT', () => {
	describe('when steering a refined retry', () => {
		it('should push toward directories and forbid placeholder site: filters', () => {
			// GIVEN the refinement hint appended on a thin retry
			// WHEN inspected
			// THEN it names authoritative sources and bans placeholder filters
			expect(REFINE_HINT).toMatch(/director/i)
			expect(REFINE_HINT).toMatch(/registr/i)
			expect(REFINE_HINT).toMatch(/placeholder site:/i)
		})

		it('should describe the previous pass as too few results, not none', () => {
			// GIVEN a retry that now also fires on a handful of results
			// WHEN the model reads why it is searching again
			// THEN it is not told the previous pass found nothing, which would be
			// untrue of every thin-but-not-empty retry
			expect(REFINE_HINT).toMatch(/too few relevant results/i)
			expect(REFINE_HINT).not.toMatch(/no relevant results/i)
		})
	})
})

describe('emptyScanFindings', () => {
	describe('when the refined retry fired and still found nothing', () => {
		it('should say the search was refined and still came up empty', () => {
			// GIVEN a scan that searched twice and named no company either time
			const findings = emptyScanFindings(true)

			// WHEN the run reports
			// THEN it says a second, refined pass was made
			expect(findings.reason).toBe('no_reliable_data')
			expect(findings.error).toMatch(/even after a refined retry/i)
		})
	})

	describe('when no retry was ever made', () => {
		it('should not claim one', () => {
			// GIVEN a scan that finished its first pass with too little budget left
			// for a second
			const findings = emptyScanFindings(false)

			// WHEN the run reports
			// THEN it still reports nothing found, but does not claim to have tried
			// twice — the retry it never got is exactly what a reader would look for
			expect(findings.reason).toBe('no_reliable_data')
			expect(findings.error).toMatch(
				/found no companies matching the criteria/i,
			)
			expect(findings.error).not.toMatch(/retry/i)
		})
	})
})
