import { describe, expect, it } from 'vitest'

import { guardScanEvidence } from './scan-evidence-guard'

const POST = 'https://www.instagram.com/p/DbBL2EVm9FK/'
const REEL = 'https://www.instagram.com/reel/DagUf0xgB1d/'
const DIRECTORY = 'https://www.thomasnet.com/suppliers/eastern-massachusetts'
// A post on a page of the poster's own, and the page itself — the pair the
// classifier used to read backwards.
const PAGE_VIDEO = 'https://www.facebook.com/mix1065sanjose/videos/123/'
const PAGE_POST =
	'https://www.facebook.com/TorredonjimenoActual/posts/1603128045156569/'
const COMPANY_PAGE = 'https://www.facebook.com/photography-studio-bcn'

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

	describe('when the only evidence is a post on a Facebook page', () => {
		it('should drop the company, as it does for any other post', () => {
			// GIVEN the shape that reached a Texas scan from California: a video
			// posted by a San Jose radio station, and nothing else. A page's own
			// post was read as an ordinary page until now, so this rule — which
			// exists to say a post is not a record that a company exists — was
			// never handed it, and the company came back as an ordinary prospect
			const findings = scan([
				{ name: 'A-Rod Auto Collision', sources: [PAGE_VIDEO] },
				{ name: 'Electricidad García', sources: [PAGE_POST] },
			])

			// WHEN checked — THEN neither survives
			const result = guardScanEvidence('prospect_scan_v1', findings)
			expect(namesOf(result.findings)).toEqual([])
			expect(result.dropped).toBe(2)
		})
	})

	describe("when the only evidence is a company's own Facebook page", () => {
		it('should keep the company', () => {
			// GIVEN a firm whose page name happens to begin with a word that also
			// names a post. Read as a post, this row would be dropped for the
			// spelling of its name — and a page is often the whole web presence of
			// exactly the small firm a scan is for
			const findings = scan([
				{ name: 'Photography Studio BCN', sources: [COMPANY_PAGE] },
			])

			// WHEN checked — THEN it stays
			const result = guardScanEvidence('prospect_scan_v1', findings)
			expect(namesOf(result.findings)).toEqual(['Photography Studio BCN'])
			expect(result.dropped).toBe(0)
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
