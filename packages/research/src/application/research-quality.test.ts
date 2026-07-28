import { describe, expect, it } from 'vitest'

import { computeRunQuality } from './research-quality'

describe('computeRunQuality', () => {
	describe('for an enrichment run', () => {
		const base = {
			schemaName: 'company_enrichment_v1',
			rounds: 6,
			sourcesTotal: 5,
			sourcesFirstParty: 3,
			fieldsGrounded: 4,
			fieldsTotal: 6,
		} as const

		it('should not flag a strong, well-grounded run', () => {
			// GIVEN the good run from the sample (6 rounds, strong match, own-domain sources)
			const quality = computeRunQuality({ ...base, entityMatch: 'strong' })
			// THEN it is trusted
			expect(quality.low_confidence).toBe(false)
			expect(quality.grounding_ratio).toBeCloseTo(0.67)
			expect(quality.sources_matched).toBe(3)
		})

		it('should flag a run whose entity match was downgraded', () => {
			// GIVEN a run where a field came from an off-entity source, so the match was
			// downgraded from strong to weak (the contamination case)
			const quality = computeRunQuality({ ...base, entityMatch: 'weak' })
			// THEN it is not safe to act on unreviewed
			expect(quality.low_confidence).toBe(true)
		})

		it('should not flag a strong run just for thin grounding', () => {
			// GIVEN a run that reached the right company (strong match) but filled little
			// of the profile — a thin-web company, not a bad run
			const quality = computeRunQuality({
				...base,
				entityMatch: 'strong',
				fieldsGrounded: 1,
				fieldsTotal: 6,
			})
			// THEN it stays trusted; the low grounding is reported in the block for a
			// caller that wants to gate on thinness itself
			expect(quality.low_confidence).toBe(false)
			expect(quality.grounding_ratio).toBeCloseTo(0.17)
		})
	})

	describe('for a prospect scan', () => {
		it('should flag a scan vetted against a single source', () => {
			// GIVEN the bad scan from the sample: one search, one source
			const quality = computeRunQuality({
				schemaName: 'prospect_scan_v1',
				entityMatch: null,
				rounds: 1,
				sourcesTotal: 1,
				sourcesFirstParty: 0,
				fieldsGrounded: 0,
				fieldsTotal: 0,
			})
			// THEN it is low confidence, and the ratio is 0 without dividing by zero
			expect(quality.low_confidence).toBe(true)
			expect(quality.grounding_ratio).toBe(0)
		})

		it('should not flag a scan vetted against several sources', () => {
			// GIVEN a scan that pulled from many sources
			const quality = computeRunQuality({
				schemaName: 'prospect_scan_v1',
				entityMatch: null,
				rounds: 3,
				sourcesTotal: 6,
				sourcesFirstParty: 0,
				fieldsGrounded: 0,
				fieldsTotal: 0,
			})
			// THEN it is trusted — this scan was pinned to no company, so there is
			// no entity verdict to weigh
			expect(quality.low_confidence).toBe(false)
		})
	})

	describe('for a scan launched from one company', () => {
		const anchoredScan = (entityMatch: 'strong' | 'weak' | 'absent'): boolean =>
			computeRunQuality({
				schemaName: 'prospect_scan_v1',
				entityMatch,
				rounds: 3,
				sourcesTotal: 6,
				sourcesFirstParty: 2,
				fieldsGrounded: 0,
				fieldsTotal: 0,
			}).low_confidence

		it('should flag one that never clearly reached that company', () => {
			// GIVEN a scan pinned to a company, vetted against plenty of sources, but
			// whose evidence only glances at the company it was launched from —
			// everything it found is a list built off the wrong starting point
			// THEN it is marked for review however many sources it read
			expect(anchoredScan('weak')).toBe(true)
			expect(anchoredScan('absent')).toBe(true)
		})

		it('should trust one that clearly reached it', () => {
			// GIVEN the same scan, this time clearly about the right company
			expect(anchoredScan('strong')).toBe(false)
		})
	})
})
