import { describe, expect, it } from 'vitest'

import { guardScanEvidence } from './scan-evidence-guard'

const POST = 'https://www.instagram.com/p/DbBL2EVm9FK/'
const REEL = 'https://www.instagram.com/reel/DagUf0xgB1d/'
const DIRECTORY = 'https://www.thomasnet.com/suppliers/eastern-massachusetts'

const scan = (
	prospects: ReadonlyArray<{
		name: string
		sources?: ReadonlyArray<string>
	}>,
) => ({
	prospects: prospects.map(p => ({
		name: p.name,
		why_relevant: 'why',
		...(p.sources === undefined
			? {}
			: { citations: p.sources.map(source_id => ({ source_id })) }),
	})),
})

const namesOf = (findings: unknown): string[] =>
	(findings as { prospects: Array<{ name: string }> }).prospects.map(
		p => p.name,
	)

describe('guardScanEvidence', () => {
	describe('when a scanned company rests on nothing but social posts', () => {
		it('should drop it', () => {
			// GIVEN a prospect whose only evidence is one Instagram post — no address,
			// no website, no directory entry
			const findings = scan([
				{ name: 'WeldFab manufacturing', sources: [POST] },
				{ name: 'Machine & Tool Co.', sources: [REEL] },
			])

			// WHEN checked — THEN neither survives: a post shows someone working, not a
			// company anyone can look up
			const result = guardScanEvidence('prospect_scan_v1', findings)
			expect(namesOf(result.findings)).toEqual([])
			expect(result.dropped).toBe(2)
			expect(result.droppedNames).toEqual([
				'WeldFab manufacturing',
				'Machine & Tool Co.',
			])
		})
	})

	describe('when a post sits alongside another source', () => {
		it('should keep the company', () => {
			// GIVEN a prospect found through a post but also listed in a directory
			const findings = scan([{ name: 'Real Fab', sources: [POST, DIRECTORY] }])

			// WHEN checked — THEN it stays: the other source is what makes it checkable,
			// and plenty of real firms are easiest to find through a post
			const result = guardScanEvidence('prospect_scan_v1', findings)
			expect(namesOf(result.findings)).toEqual(['Real Fab'])
			expect(result.dropped).toBe(0)
		})
	})

	describe('when a scanned company cites nothing at all', () => {
		it('should leave it alone', () => {
			// GIVEN a prospect with no citations
			const findings = scan([{ name: 'Uncited' }])

			// WHEN checked — THEN this rule stays quiet: citing nothing is a different
			// shortfall, and the citation guard and the run's quality signal answer it
			const result = guardScanEvidence('prospect_scan_v1', findings)
			expect(namesOf(result.findings)).toEqual(['Uncited'])
			expect(result.dropped).toBe(0)
		})
	})

	describe('when the run is not a discovery scan', () => {
		it('should pass the findings through untouched', () => {
			// GIVEN an enrichment run that happens to cite a post
			const findings = scan([{ name: 'Anything', sources: [POST] }])

			// WHEN checked — THEN nothing is dropped: the company was named by the
			// caller, so it does not have to prove it exists
			const result = guardScanEvidence('company_enrichment_v1', findings)
			expect(namesOf(result.findings)).toEqual(['Anything'])
			expect(result.dropped).toBe(0)
		})
	})

	describe('when the findings are not the shape a scan returns', () => {
		it('should pass them through rather than throwing', () => {
			// GIVEN findings that are a bare string
			const result = guardScanEvidence('prospect_scan_v1', 'not findings')
			expect(result.findings).toBe('not findings')
			expect(result.dropped).toBe(0)
		})
	})
})
