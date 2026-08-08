import { describe, expect, it } from 'vitest'

import { guardCompanyWebsites } from './website-guard'

// A competitor/prospect entry: a name plus the website the model returned for it.
const scan = (
	competitors: ReadonlyArray<{ name: string; website?: string }>,
) => ({
	competitors,
})

const websitesOf = (findings: unknown): Array<string | undefined> =>
	(findings as { competitors: Array<{ website?: string }> }).competitors.map(
		c => c.website,
	)

// The same entry as a scan returns it: the address paired with the page it was
// read on, which is the shape the citation guard can judge.
const sourcedScan = (
	prospects: ReadonlyArray<{ name: string; website?: string }>,
) => ({
	prospects: prospects.map(p => ({
		name: p.name,
		...(p.website === undefined
			? {}
			: { website: { value: p.website, source_id: 'src_1' } }),
	})),
})

const sourcedWebsitesOf = (findings: unknown): Array<string | undefined> =>
	(
		findings as { prospects: Array<{ website?: { value?: string } }> }
	).prospects.map(p => p.website?.value)

describe('guardCompanyWebsites', () => {
	describe('when the website is a known directory', () => {
		it('should blank a company-profile page and count it as a directory', () => {
			// GIVEN a competitor whose "website" is a CB Insights profile page
			const findings = scan([
				{
					name: 'Redwood Logistics',
					website: 'https://www.cbinsights.com/company/redwood-logistics',
				},
			])

			// WHEN the websites are checked
			const result = guardCompanyWebsites(findings)

			// THEN the directory URL is removed and the reason is recorded
			expect(websitesOf(result.findings)).toEqual([undefined])
			expect(result.blankedDirectory).toBe(1)
			expect(result.blankedProfilePage).toBe(0)
		})

		it('should blank a page on a subdomain of a known directory', () => {
			// GIVEN a research subdomain of a listed aggregator
			const findings = scan([
				{
					name: 'Acme Freight',
					website: 'https://research.owler.com/company/acme',
				},
			])

			// WHEN checked — THEN the subdomain is treated as the directory it is
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([undefined])
			expect(result.blankedDirectory).toBe(1)
		})
	})

	describe('when the website is an unknown host with the name in a deeper path', () => {
		it('should blank it as a profile page — the listing shape, no list needed', () => {
			// GIVEN a directory nobody put on the known list, filing the company one
			// level down
			const findings = scan([
				{
					name: 'Redwood Logistics',
					website:
						'https://some-unknown-directory.io/company/redwood-logistics',
				},
			])

			// WHEN checked — THEN it is still caught, by the address shape alone
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([undefined])
			expect(result.blankedProfilePage).toBe(1)
			expect(result.blankedDirectory).toBe(0)
		})

		it('should blank one even when the company name is short', () => {
			// GIVEN a three-letter company filed under a directory path
			const findings = scan([
				{ name: 'DSV', website: 'https://crunchbase.com/organization/dsv' },
			])

			// WHEN checked — THEN a short name is no reason to let a listing through
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([undefined])
		})
	})

	describe('when the website is the company own site', () => {
		it('should keep a host that carries the company name', () => {
			// GIVEN the company's own domain
			const findings = scan([
				{
					name: 'Redwood Logistics',
					website: 'https://redwoodlogistics.com/about',
				},
			])

			// WHEN checked — THEN it is left untouched
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([
				'https://redwoodlogistics.com/about',
			])
			expect(result.blankedDirectory + result.blankedProfilePage).toBe(0)
		})

		it('should keep a name that sits in the first path segment', () => {
			// GIVEN a company describing itself on its own site, name in segment one
			const findings = scan([
				{
					name: 'XPO Logistics',
					website: 'https://xpo.com/about-xpo-logistics',
				},
			])

			// WHEN checked — THEN a first-segment mention is a company describing
			// itself, not a directory filing it away
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([
				'https://xpo.com/about-xpo-logistics',
			])
		})

		it('should keep a short host that does not spell out the whole name', () => {
			// GIVEN a company whose own domain does not contain its full name
			const findings = scan([
				{ name: 'Penske Logistics', website: 'https://gopenske.com/logistics' },
			])

			// WHEN checked — THEN it is kept: the name is in no deeper path segment
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([
				'https://gopenske.com/logistics',
			])
		})

		it('should keep a bare host with no path at all', () => {
			// GIVEN a plain domain
			const findings = scan([{ name: 'DSV', website: 'https://dsv.com' }])

			// WHEN checked — THEN nothing to file it away, so it stays
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual(['https://dsv.com'])
		})

		it('should keep an own-site path even when the name repeats in it', () => {
			// GIVEN a host that names the company AND repeats it in a deeper path
			const findings = scan([
				{
					name: 'Acme Logistics',
					website: 'https://acmelogistics.com/company/acme-logistics',
				},
			])

			// WHEN checked — THEN the host naming the company is the deciding signal
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([
				'https://acmelogistics.com/company/acme-logistics',
			])
		})
	})

	describe('when the website is a scheme-less host', () => {
		it('should classify it the same as one with a scheme', () => {
			// GIVEN a tidied bare host on a directory
			const findings = scan([
				{
					name: 'Redwood Logistics',
					website: 'cbinsights.com/company/redwood-logistics',
				},
			])

			// WHEN checked — THEN the missing scheme does not hide the directory
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([undefined])
			expect(result.blankedDirectory).toBe(1)
		})
	})

	describe('when the input is degenerate', () => {
		it('should keep an unparseable website rather than guess', () => {
			// GIVEN a website that is not a URL at all
			const findings = scan([{ name: 'Acme', website: 'not a url' }])

			// WHEN checked — THEN with no host to read, it is left alone
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual(['not a url'])
		})

		it('should keep a website when the name is empty', () => {
			// GIVEN a nameless entry — nothing to match a host or path against
			const findings = scan([
				{ name: '', website: 'https://some-directory.io/company/acme' },
			])

			// WHEN checked — THEN it cannot be judged, so it stays
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([
				'https://some-directory.io/company/acme',
			])
		})

		it('should pass through an entry with a name but no website', () => {
			// GIVEN a competitor the model gave no website
			const findings = scan([{ name: 'Acme Logistics' }])

			// WHEN checked — THEN nothing to blank, and it is unchanged
			const result = guardCompanyWebsites(findings)
			expect(result).toEqual({
				findings,
				blankedDirectory: 0,
				blankedProfilePage: 0,
			})
		})

		it('should leave findings that are null or a bare value untouched', () => {
			// GIVEN non-object findings
			// WHEN checked — THEN they pass straight through
			expect(guardCompanyWebsites(null).findings).toBeNull()
			expect(guardCompanyWebsites('text').findings).toBe('text')
			expect(guardCompanyWebsites([1, 2]).findings).toEqual([1, 2])
		})
	})

	describe('when the same shape appears under a different schema', () => {
		it('should blank a prospect website the same way as a competitor one', () => {
			// GIVEN a prospect (not a competitor) carrying a directory URL
			const findings = {
				prospects: [
					{
						name: 'Redwood Logistics',
						website: 'https://cbinsights.com/company/redwood-logistics',
					},
				],
			}

			// WHEN checked — THEN the walk fires on the shape, not the schema name
			const result = guardCompanyWebsites(findings)
			expect(
				(result.findings as { prospects: Array<{ website?: string }> })
					.prospects[0]?.website,
			).toBeUndefined()
		})
	})

	describe('when the run answers with the target company own website', () => {
		it('should blank a known directory even with no name to compare', () => {
			// GIVEN the profile's website field pointing at an aggregator listing
			const findings = {
				enrichment: {
					website: {
						value: 'https://www.crunchbase.com/organization/acme',
						source_id: 'src_a',
						confidence: null,
					},
				},
			}

			// WHEN checked with no target name supplied
			const result = guardCompanyWebsites(findings)

			// THEN the known-directory rule still fires, which is the whole point
			expect(
				(result.findings as { enrichment: Record<string, unknown> }).enrichment[
					'website'
				],
			).toBeNull()
			expect(result.blankedDirectory).toBe(1)
		})

		it('should blank a listing on an unknown host once the target name is known', () => {
			// GIVEN a directory we do not list, filing the company one level down
			const findings = {
				enrichment: {
					website: {
						value: 'https://empresas.example.org/company/redwood-logistics',
						source_id: 'src_a',
						confidence: null,
					},
				},
			}

			// WHEN checked against the company the run is about
			const result = guardCompanyWebsites(findings, 'Redwood Logistics')

			// THEN the name-in-a-deeper-path rule catches it
			expect(
				(result.findings as { enrichment: Record<string, unknown> }).enrichment[
					'website'
				],
			).toBeNull()
			expect(result.blankedProfilePage).toBe(1)
		})

		it('should keep the company own site', () => {
			// GIVEN the company's real website
			const website = {
				value: 'https://redwoodlogistics.com/about',
				source_id: 'src_a',
				confidence: null,
			}
			const findings = { enrichment: { website } }

			// WHEN checked against the company the run is about
			const result = guardCompanyWebsites(findings, 'Redwood Logistics')

			// THEN the host carries the name, so it stands
			expect(
				(result.findings as { enrichment: Record<string, unknown> }).enrichment[
					'website'
				],
			).toEqual(website)
			expect(result.blankedDirectory + result.blankedProfilePage).toBe(0)
		})

		it('should leave a competitor website judged against its own name', () => {
			// GIVEN a competitor entry whose site is its own, beside a target name
			// that has nothing to do with it
			const findings = {
				competitors: [
					{ name: 'Rival Freight', website: 'https://rivalfreight.com' },
				],
			}

			// WHEN checked while the run is about a different company
			const result = guardCompanyWebsites(findings, 'Redwood Logistics')

			// THEN the pair rule wins for a named company, so the site is kept
			expect(result.findings).toEqual(findings)
			expect(result.blankedDirectory + result.blankedProfilePage).toBe(0)
		})
	})

	describe('when a proposed update carries a person name and a website', () => {
		it('should not match a contact name against a host', () => {
			// GIVEN a create proposal whose fields hold a PERSON's name and a site
			const findings = {
				proposed_updates: [
					{
						operation: 'create',
						fields: {
							name: 'Ada Lovelace',
							website: 'https://cbinsights.com/person/ada-lovelace',
						},
					},
				],
			}

			// WHEN checked — THEN the proposed-updates subtree is left untouched, so a
			// person's website is never blanked as if it were a company's
			const result = guardCompanyWebsites(findings)
			expect(result.findings).toEqual(findings)
			expect(result.blankedDirectory + result.blankedProfilePage).toBe(0)
		})
	})
	describe('when a scanned prospect carries the page its website came from', () => {
		it('should judge the address against that prospect, not the run target', () => {
			// GIVEN a prospect whose "website" is a listing about it on someone else's
			// directory, given as a value paired with its source
			const findings = sourcedScan([
				{
					name: 'Redwood Logistics',
					website:
						'https://some-unknown-directory.io/company/redwood-logistics',
				},
			])

			// WHEN checked — THEN it is still caught. The name to match sits beside the
			// address in the entry; a scan has no single company to fall back on, so
			// judging against the run instead would let every listing through
			const result = guardCompanyWebsites(findings)
			expect(sourcedWebsitesOf(result.findings)).toEqual([undefined])
			expect(result.blankedProfilePage).toBe(1)
		})

		it('should keep a prospect on its own site', () => {
			// GIVEN a prospect whose address is its own domain
			const findings = sourcedScan([
				{ name: 'Redwood Logistics', website: 'https://redwoodlogistics.com' },
			])

			// WHEN checked — THEN it survives with its source intact
			const result = guardCompanyWebsites(findings)
			expect(sourcedWebsitesOf(result.findings)).toEqual([
				'https://redwoodlogistics.com',
			])
			expect(result.blankedProfilePage).toBe(0)
			expect(result.blankedDirectory).toBe(0)
		})
	})
})
