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
			citationsSeen: 4,
			citationsKept: 4,
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
		const scan = {
			schemaName: 'prospect_scan_v1',
			entityMatch: null,
			rounds: 3,
			sourcesTotal: 6,
			sourcesFirstParty: 0,
			fieldsGrounded: 0,
			fieldsTotal: 0,
			citationsSeen: 10,
			citationsKept: 10,
		} as const

		it('should flag a scan vetted against a single source', () => {
			// GIVEN the bad scan from the sample: one search, one source
			const quality = computeRunQuality({
				...scan,
				rounds: 1,
				sourcesTotal: 1,
			})
			// THEN it is low confidence
			expect(quality.low_confidence).toBe(true)
		})

		it('should not flag a scan vetted against several sources', () => {
			// GIVEN a scan that pulled from many sources
			const quality = computeRunQuality(scan)
			// THEN it is trusted — this scan was pinned to no company, so there is
			// no entity verdict to weigh
			expect(quality.low_confidence).toBe(false)
		})

		it('should leave out the profile numbers a scan cannot have', () => {
			// GIVEN any scan, which fills no company profile
			const quality = computeRunQuality(scan)
			// THEN the profile measures are absent rather than reported as zero, which
			// would read as a failing grade on every scan ever run
			expect(quality.grounding_ratio).toBeUndefined()
			expect(quality.fields_grounded).toBeUndefined()
		})
	})

	describe('when the citation guard weighed what a run cited', () => {
		const scanBase = {
			schemaName: 'prospect_scan_v1',
			entityMatch: null,
			rounds: 5,
			sourcesTotal: 2,
			sourcesFirstParty: 0,
			fieldsGrounded: 0,
			fieldsTotal: 0,
		} as const

		it('should flag a run whose citations were all rejected', () => {
			// GIVEN a scan that offered 31 citations and had every one rejected as
			// pointing at a page it never reached
			const quality = computeRunQuality({
				...scanBase,
				citationsSeen: 31,
				citationsKept: 0,
			})
			// THEN nothing stands behind the findings, so they are not safe to act
			// on unread
			expect(quality.low_confidence).toBe(true)
			expect(quality.citations_seen).toBe(31)
			expect(quality.citations_kept).toBe(0)
		})

		it('should not flag a run that cited nothing at all', () => {
			// GIVEN a scan that offered no citations, so the guard rejected none
			const quality = computeRunQuality({
				...scanBase,
				citationsSeen: 0,
				citationsKept: 0,
			})
			// THEN this signal stays quiet — citing nothing is a different shortfall,
			// and the source and entity checks are what judge it
			expect(quality.low_confidence).toBe(false)
		})

		it('should not flag a run that kept even one citation', () => {
			// GIVEN a scan where most citations were rejected but one resolved
			const quality = computeRunQuality({
				...scanBase,
				citationsSeen: 12,
				citationsKept: 1,
			})
			// THEN it is not flagged by this signal: the run did reach a page it cited
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
				citationsSeen: 8,
				citationsKept: 8,
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
